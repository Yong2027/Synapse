import * as vscode from "vscode";
import { CallHierarchyNode } from "./node_graph";
import { generateCallGraphCSV } from "./utils/common";
import { ReferNode } from "./interface";
import { CallGraphEntry } from "../call_graph/entry";
import { DocumentSymbol } from "vscode";
import { Log } from "../util/logger";
import {
    insertOutgoingNodeToGraph,
    removeChildrenFromNode,
} from "./node_graph";
import { generateDot, generateOutgoingDot } from "./node_incoming_dot";
import {
    getFuncCallNodeGraph,
    getMaxIncomingGraphRealDepth,
} from "./node_graph";
import {
    unifyDotLabelEllipsis,
    addCirclePlusToEllipsisNodes,
} from "./generator";
export interface webviewFrontendFlags {
    ifCompleteGraph?: boolean;
}
export enum GraphType {
    Reference = "reference",
    Incoming = "incoming",
    Outgoing = "outgoing",
    OutgoingTree = "outgoingTree",
}
// @ts-ignore - ESM module handled by esbuild
import { instance as vizInstance } from "@viz-js/viz";
const viz = vizInstance();

export function logNodeNames(node: CallHierarchyNode, depth: number = 0) {
    const indent = "  ".repeat(depth);
    // Log.info(`显示层级关系webview: ${indent}${node.item.name}`);
    for (const child of node.children) {
        logNodeNames(child, depth + 1);
    }
}

export interface GraphPanelFunction {
    isJump2Function?: boolean; //跳转函数
    isJump2File?: boolean; //跳转文件
    isGenerateReferenceGraph?: boolean; //生成引用图
    isGenerateOutgoingGraph?: boolean; //生成调用图
    isCopyFunction?: boolean; //复制函数
    isJumpToTheFirstReference?: boolean; //跳转到第一个引用
    isGenerateReferenceGraphForThisFile?: boolean; //为当前文件生成引用图
    isGenerateReferenceGraphForAllFiles?: boolean; //为所有文件生成引用图
    isCopyFunctionInRefGraph?: boolean; //在引用图中复制函数
    isGenerateOutgoingGraphForThisNode?: boolean; //为当前节点生成调用图
    isCopyFilePath?: boolean; //复制文件路径
    isExportCallGraphToCSV?: boolean; //导出调用图为CSV
    isExportCallGraphToSVG?: boolean; //导出调用图为SVG
    // 可扩展更多右键功能...
}

export interface GraphPanelParameters {
    refName?: string;
    uri2RangesMap?: Map<string, vscode.Range[]>;
    is_complete_graph?: boolean;
    // 可扩展更多参数...
}

export class CallGraphPanel {
    public static readonly viewType = "wall_e.callgraph";
    public static currentPanel: CallGraphPanel | null = null;
    protected static num = 1;
    protected readonly _panel: vscode.WebviewPanel;
    protected _disposables: vscode.Disposable[] = [];
    protected _graph: CallHierarchyNode;
    protected _graphType: GraphType;
    protected _isCursorIDE: boolean = false;
    protected _graphFunction?: GraphPanelFunction;
    protected _graphPanelParameters?: GraphPanelParameters;
    protected webviewName: string = ""; // Default value
    protected _context: vscode.ExtensionContext;
    private _currentDot: string = ""; // 保存当前完整 DOT
    private _currentExpandedNode: string = ""; // 保存当前展开的节点标识
    private _currentKeyword: string = ""; // 保存当前搜索关键词
    private _nodeFlags: Map<string, number> = new Map(); // 节点标志状态：1=十字，0=减号
    // 新增：用于管理层级控制状态
    private _incomingLevelValue: string = ""; // 默认值（输入框）

    protected _overLimtMap: Map<string, DocumentSymbol[]> = new Map();
    public constructor(
        context: vscode.ExtensionContext,
        graphType: GraphType,
        graph?: CallHierarchyNode,
        graphFunction?: GraphPanelFunction,
        graphPanelParameters?: GraphPanelParameters,
    ) {
        this._context = context;
        this._graphType = graphType;
        this._graph = graph || ({ item: { name: "" } } as CallHierarchyNode);
        this._graphFunction = graphFunction;
        this._graphPanelParameters = graphPanelParameters;

        // 设置 webviewName
        const refName = graphPanelParameters?.refName || "";
        if (refName) {
            if (refName.includes("#") && refName.includes("@")) {
                this.webviewName = refName.split("#")[1].split("@")[0];
            } else {
                this.webviewName = refName;
            }
        } else if (this._graph?.item?.name) {
            this.webviewName = this._graph.item.name.includes("::")
                ? this._graph.item.name.split("::").pop()!
                : this._graph.item.name;
        }

        const extensionUri = context.extensionUri;
        const panel = vscode.window.createWebviewPanel(
            CallGraphPanel.viewType,
            this.webviewName,
            vscode.ViewColumn.One,
            {
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, "tools", "call_graph"),
                    vscode.Uri.joinPath(
                        extensionUri,
                        "tools",
                        "outgoing_graph",
                    ),
                ],
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );
        panel.iconPath = vscode.Uri.joinPath(
            extensionUri,
            "tools",
            "call_graph",
            "../../resource/icon/logo.png",
        );
        this._panel = panel;
        // 每次生成webview时，清空上一次保存的搜索框消息
        this._panel.webview.postMessage({ command: "CLEAR_KEYWORD" });
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case "EVENT_OUTGOING_REGENERATE": {
                        const { item } = message.data || {};
                        await this.regenerateOutgoingGraph(item);
                        break;
                    }
                    case "LOAD_OUTGOING_DEEPER": {
                        try {
                            const { item, nodeId } = message.data || {};
                            if (!item) {
                                return;
                            }
                            let entryItem = item;
                            // 判断 item 是否为 JSON（即不是 VSCode 的 CallHierarchyItem 实例）
                            if (
                                item &&
                                item.uri &&
                                item.range &&
                                Array.isArray(item.range)
                            ) {
                                const uri =
                                    typeof item.uri === "string"
                                        ? vscode.Uri.parse(item.uri)
                                        : vscode.Uri.file(
                                              item.uri.fsPath || item.uri.path,
                                          );
                                const pos = new vscode.Position(
                                    item.range[0].line,
                                    item.range[0].character,
                                );
                                const items =
                                    await vscode.commands.executeCommand<
                                        vscode.CallHierarchyItem[]
                                    >("vscode.prepareCallHierarchy", uri, pos);
                                if (items && items.length > 0) {
                                    entryItem = items[0];
                                }
                            }
                            const mod = await import("./node_graph.js");
                            let childrenNode: CallHierarchyNode;
                            childrenNode = await mod.getFuncCallNodeGraph(
                                entryItem,
                                true,
                                true,
                                5,
                            );
                            let children =
                                childrenNode && childrenNode.children
                                    ? childrenNode.children
                                    : [];
                            this._panel.webview.postMessage({
                                command: "OUTGOING_DEEPER_LOADED",
                                nodeId,
                                children: children,
                            });
                        } catch (e) {
                            this._panel.webview.postMessage({
                                command: "OUTGOING_DEEPER_LOADED",
                                nodeId: message.data && message.data.nodeId,
                                children: [],
                            });
                        }
                        break;
                    }
                    case "EVENT_APPLY_INCOMING_LEVEL": {
                        // add user statics
                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: "Regenerate Incoming Call Graph…",
                                cancellable: false,
                            },
                            async (progress) => {
                                try {
                                    const incoming_level = parseInt(
                                        message.level,
                                        10,
                                    ); // 用户输入的层数
                                    // 输入框显示的层数 = 用户输入层数 + 1（因为根节点算第 1 层）
                                    this._incomingLevelValue =
                                        incoming_level.toString();

                                    // 调用图构建（根据用户指定的层数 level）
                                    const displayGraph =
                                        await getFuncCallNodeGraph(
                                            this._graph.item,
                                            false, // incoming
                                            false, // non-tree
                                            incoming_level - 1, // 用户输入的层数
                                            0,
                                        );

                                    // 真实最大深度来自 getFuncCallNodeGraph 返回值
                                    const curIncomingGrapDepth =
                                        getMaxIncomingGraphRealDepth();
                                    // 用户输入层数超过真实最大深度 → 提示
                                    if (incoming_level > curIncomingGrapDepth) {
                                        Log.info(
                                            `INFO: Current incoming call graph level is ${curIncomingGrapDepth + 1}.`,
                                        );
                                    }
                                    // 保存图结构
                                    this._graph = displayGraph;

                                    const dotString =
                                        generateDot(displayGraph).toString();
                                    this._currentDot = dotString;

                                    const svg = await (await viz).renderString(
                                        unifyDotLabelEllipsis(dotString),
                                        { format: "svg" },
                                    );

                                    const keywordStorageKey =
                                        message.keyword || "";
                                    this._currentKeyword = keywordStorageKey;

                                    await this.showCallGraph(
                                        svg,
                                        true,
                                        dotString,
                                        this._currentKeyword,
                                    );
                                } catch (err) {
                                    console.error(
                                        "Failed to regenerate incoming call graph:",
                                        err,
                                    );
                                    vscode.window.showErrorMessage(
                                        "Failed to regenerate incoming call graph.",
                                    );
                                }
                            },
                        );
                        break;
                    }

                    case "GET_FUNCTION_PARAMETERS": {
                        try {
                            const { item, requestId } = message.data || {};
                            if (!item) {
                                return;
                            }
                            let entryItem = item;
                            // 判断 item 是否为 JSON（即不是 VSCode 的 CallHierarchyItem 实例）
                            if (item && item.uri && item.range) {
                                let uri: vscode.Uri;
                                let pos: vscode.Position;
                                if (typeof item.uri === "string") {
                                    uri = vscode.Uri.parse(item.uri);
                                } else {
                                    uri = vscode.Uri.file(
                                        item.uri.fsPath || item.uri.path,
                                    );
                                }
                                if (Array.isArray(item.range)) {
                                    pos = new vscode.Position(
                                        item.range[0].line,
                                        item.range[0].character,
                                    );
                                } else if (item.range.start) {
                                    pos = new vscode.Position(
                                        item.range.start.line,
                                        item.range.start.character,
                                    );
                                } else {
                                    pos = new vscode.Position(0, 0);
                                }
                                const items =
                                    await vscode.commands.executeCommand<
                                        vscode.CallHierarchyItem[]
                                    >("vscode.prepareCallHierarchy", uri, pos);
                                if (items && items.length > 0) {
                                    entryItem = items[0];
                                }
                            }
                            const parameters =
                                await extractFunctionParameters(entryItem);

                            this._panel.webview.postMessage({
                                command: "FUNCTION_PARAMETERS_LOADED",
                                requestId,
                                parameters,
                            });
                        } catch (e) {
                            this._panel.webview.postMessage({
                                command: "FUNCTION_PARAMETERS_LOADED",
                                requestId:
                                    message.data && message.data.requestId,
                                parameters: "",
                            });
                        }
                        break;
                    }
                    case "EVENT_EXPORT_SVG":
                        this.saveSVG(message.svg);
                        if (this._graphType === GraphType.Reference) {
                        } else if (this._graphType === GraphType.Incoming) {
                        } else if (this._graphType === GraphType.Outgoing) {
                        } else if (this._graphType === GraphType.OutgoingTree) {
                        }
                        break;
                    case "EVENT_JUMP2CODE":
                        this.jumpToCode(message.data);
                        break;
                    case "EVENT_EXPORT_CSV":
                        this.saveCSV(this._graph);
                        if (this._graphType === GraphType.Reference) {
                        } else if (this._graphType === GraphType.Incoming) {
                        } else if (this._graphType === GraphType.Outgoing) {
                        } else if (this._graphType === GraphType.OutgoingTree) {
                        }

                        break;
                    case "EVENT_COPY":
                        vscode.env.clipboard.writeText(message.text);
                        if (
                            this._graph &&
                            this._graph.item &&
                            this._graph.item.name !== ""
                        ) {
                        }

                        const refName =
                            this._graphPanelParameters?.refName || "";
                        if (refName && refName.trim() !== "") {
                        }
                        break;
                    case "EVENT_FILE_PATH_COPY":
                        vscode.env.clipboard.writeText(message.text);
                        if (
                            this._graph &&
                            this._graph.item &&
                            this._graph.item.name !== ""
                        ) {
                        }

                        const refName2 =
                            this._graphPanelParameters?.refName || "";
                        if (refName2 && refName2.trim() !== "") {
                        }
                        break;
                    
                    case "EVENT_CLICK":
                        // Log.info("点击事件: " + message.data);
                        this.jumpToCode(message.data);
                        break;
                    case "EVENT_CALL_MULTIPLE_FUNC_GRAPH":
                        this.refFuncMultipleCallGraph(message.data);
                        break;
                    case "EVENT_CALL_ALL_FILES_FUNC_GRAPH":
                        // console.log(uri2RangesMap);
                        this.allFilesCallGraph(
                            this._graphPanelParameters?.uri2RangesMap ??
                                new Map(),
                        );
                        break;
                    

                    
                    case "EVENT_FUNCTION_DEEPDIVE_WARNING":
                        vscode.window.showWarningMessage(
                            "Function DeepDive is still in progress...",
                        );
                        break;
                    case "EVENT_OUTGOING_CALL_GRAPH":
                        this._context = context;
                        if (!message.data || !this._context) {
                            vscode.window.showErrorMessage(
                                "No node information or context was obtained",
                            );
                            break;
                        }
                        // 解析节点 title，获取 uri 和位置
                        const [filePath, anchor] = message.data.split("#");
                        const match = anchor?.match(/@(\d+):(\d+)/);
                        const line = match ? parseInt(match[1], 10) : 0;
                        const char = match ? parseInt(match[2], 10) : 0;
                        const uri = vscode.Uri.file(filePath);
                        vscode.workspace.openTextDocument(uri).then((doc) => {
                            const position = new vscode.Position(
                                line - 1,
                                char,
                            );
                            vscode.commands
                                .executeCommand<
                                    vscode.CallHierarchyItem[]
                                >("vscode.prepareCallHierarchy", uri, position)
                                .then((entry) => {
                                    if (!entry || !entry[0]) {
                                        vscode.window.showErrorMessage(
                                            "The calling hierarchy information for the function was not found",
                                        );
                                        return;
                                    }
                                    // 生成 outgoing call graph
                                    let manager = new CallGraphEntry(
                                        this._context!,
                                    );
                                    manager.generateFuncOutgoingGraphInGraph([
                                        entry[0],
                                    ]);
                                });
                        });
                        break;
                    case "EVENT_EXPAND_NODE":
                        this._context = context;
                        if (!message.data || !this._context) {
                            vscode.window.showErrorMessage(
                                "No node information or context was obtained",
                            );
                            break;
                        }
                        this._currentExpandedNode = message.data; //8.29
                        // 保存传递过来的搜索关键词键名
                        const keywordStorageKey = message.keyword || "";
                        this._currentKeyword = keywordStorageKey; // 直接保存键名，将在前端通过localStorage获取实际值
                        // 切换节点标志状态：1变0，0变1
                        const currentFlag =
                            this._nodeFlags.get(message.data) ?? 1;
                        const newFlag = currentFlag === 1 ? 0 : 1;
                        this._nodeFlags.set(message.data, newFlag);
                        // 如果是展开操作（从1变0），需要加载新的子节点
                        if (newFlag === 0) {
                            await vscode.window.withProgress(
                                {
                                    location:
                                        vscode.ProgressLocation.Notification,
                                    title: "Expanding current node...",
                                    cancellable: true,
                                },
                                async () => {
                                    // 解析节点 title，获取 uri 和位置
                                    const [filePath1, anchor1] =
                                        message.data.split("#");
                                    const match1 =
                                        anchor1?.match(/@(\d+):(\d+)/);
                                    const line1 = match1
                                        ? parseInt(match1[1], 10)
                                        : 0;
                                    const char1 = match1
                                        ? parseInt(match1[2], 10)
                                        : 0;
                                    const uri1 = vscode.Uri.file(filePath1);

                                    await vscode.workspace
                                        .openTextDocument(uri1)
                                        .then(async (doc) => {
                                            let position = new vscode.Position(
                                                line1 - 1,
                                                char1,
                                            );
                                            if (position.line > 0) {
                                                const previousLine = doc.lineAt(
                                                    position.line - 1,
                                                ).text;
                                                const templateRegex =
                                                    /template\s+<.*>/;
                                                if (
                                                    templateRegex.test(
                                                        previousLine,
                                                    )
                                                ) {
                                                    // 上移一行，列号改为0
                                                    position =
                                                        new vscode.Position(
                                                            position.line - 1,
                                                            0,
                                                        );
                                                    Log.debug(
                                                        "Detected template declaration.",
                                                    );
                                                }
                                            }
                                            const entry =
                                                await vscode.commands.executeCommand<
                                                    vscode.CallHierarchyItem[]
                                                >(
                                                    "vscode.prepareCallHierarchy",
                                                    uri1,
                                                    position,
                                                );
                                            if (!entry || !entry[0]) {
                                                vscode.window.showErrorMessage(
                                                    "The calling hierarchy information for the function was not found",
                                                );
                                                return;
                                            }
                                            //当前展开时只需要新增一层子节点
                                            const newNode =
                                                await getFuncCallNodeGraph(
                                                    entry[0],
                                                    true,
                                                    false, //新增
                                                    undefined, // 新增
                                                    1,
                                                );
                                            //将展开的子节点加入到现有的_graph中
                                            insertOutgoingNodeToGraph(
                                                this._graph,
                                                newNode,
                                            );

                                            this._currentDot =
                                                generateOutgoingDot(
                                                    this._graph,
                                                    100,
                                                ).toString();

                                            const coloredDot =
                                                unifyDotLabelEllipsis(
                                                    this._currentDot,
                                                    this._currentExpandedNode,
                                                );
                                            let svg = await (await viz).renderString(
                                                coloredDot,
                                                { format: "svg" },
                                            );

                                            // 在SVG中增加使用新的标志系统渲染圆圈
                                            svg = addCirclePlusToEllipsisNodes(
                                                svg,
                                                this._nodeFlags,
                                            );
                                            await this.showCallGraph(
                                                svg,
                                                true,
                                                this._currentDot,
                                                keywordStorageKey, // 传递关键词键名
                                            );
                                        });
                                },
                            );
                        } else {
                            // 使用新的移除子节点函数，包括从_graph 和 _nodeFlags移除
                            const removeSuccess = removeChildrenFromNode(
                                this._graph,
                                message.data,
                                this._nodeFlags, // 传入节点状态 Map,清楚节点状态
                            );

                            if (removeSuccess) {
                                this._currentDot = generateOutgoingDot(
                                    this._graph,
                                    100,
                                ).toString();
                                const coloredDot = unifyDotLabelEllipsis(
                                    this._currentDot,
                                );
                                viz.then((v) => v.renderString(coloredDot, {
                                    format: "svg",
                                })).then(async (svg: string) => {
                                    // 使用新的标志系统渲染圆圈
                                    svg = addCirclePlusToEllipsisNodes(
                                        svg,
                                        this._nodeFlags,
                                    );
                                    await this.showCallGraph(
                                        svg,
                                        true,
                                        this._currentDot,
                                        keywordStorageKey, // 传递关键词键名
                                    );
                                });
                            } else {
                                vscode.window.showErrorMessage(
                                    "Failed to collapse node !",
                                );
                            }
                        }
                        break;
                    case "SVG_RENDERED":
                        this._panel.webview.postMessage({
                            command: "SVG_RENDERED_FINISH",
                            data: message.data,
                            keyword: this._currentKeyword || "", // 传递保存的关键词
                        });
                        break;
                    case "EVENT_HIGHLIGHT":
                        switch (this._graphType) {
                            case "reference":
                                break;
                            case "incoming":
                                break;
                            case "outgoing":
                                break;
                            case "outgoingTree":
                                break;
                            // 可扩展更多类型
                            default:
                                break;
                        }
                        break;
                    case "EVENT_SEARCH":
                        switch (this._graphType) {
                            case "reference":
                                break;
                            case "incoming":
                                break;
                            case "outgoing":
                                break;
                            case "outgoingTree":
                                break;
                            default:
                                break;
                        }
                        break;
                    case "EVENT_RESET":
                        switch (this._graphType) {
                            case "reference":
                                break;
                            case "incoming":
                                break;
                            case "outgoing":
                                break;
                            case "outgoingTree":
                                break;
                            default:
                                break;
                        }
                        break;
                    case "EVENT_OUTGOING_GRAPH_EXPAND_ALL":
                        break;
                    case "EVENT_OUTGOING_GRAPH_COLLAPSE_ALL":
                        break;
                    case "EVENT_OUTGOING_GRAPH_SELECT_DEPTH":
                        break;
                    case "EVENT_OUTGOING_GRAPH_EXPAND_NODE":
                        break;
                    case "EVENT_OUTGOING_GRAPH_COLLAPSE_NODE":
                        break;
                    case "EVENT_OUTGOING_TREE_PIN":
                    case "EVENT_OUTGOING_TREE_UNPIN":
                }
            },
            null,
            this._disposables,
        );

        this._panel.onDidChangeViewState(
            (e) => {
                if (panel.active) {
                    CallGraphPanel.currentPanel = this;
                } else if (CallGraphPanel.currentPanel !== this) {
                    return;
                } else {
                    CallGraphPanel.currentPanel = null;
                }
            },
            null,
            this._disposables,
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        CallGraphPanel.num += 1;
    }
    // 用于插件和webview前端直接的数据交换
    public postMessage(message: any) {
        this._panel.webview.postMessage(message);
    }

    public dispose() {
        if (CallGraphPanel.currentPanel === this) {
            CallGraphPanel.currentPanel = null;
        }

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    public async showCallGraph(
        svg: string,
        focusMode: boolean,
        dot?: string,
        keyword?: string,
    ) {
        // 初始化赋值
        if (dot) {
            this._currentDot = dot;
            // Log.info("当前第二处DOT片段：" + this._currentDot);
        }
        if (keyword !== undefined) {
            this._currentKeyword = keyword;
        }
        const resourceUri = vscode.Uri.joinPath(
            this._context.extensionUri,
            "tools",
            "call_graph",
        );
        const filePromises = [
            "variables.css",
            "styles.css",
            "panzoom.min.js",
            "event.js",
        ].map((fileName) =>
            vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(resourceUri, fileName),
            ),
        );

        this._isCursorIDE = vscode.env.appName.toLowerCase().includes("cursor");

        CallGraphPanel.currentPanel = this;
        const nonce = getNonce();

        Promise.all([...filePromises]).then(
            ([cssVariables, cssStyles, ...scripts]) => {
                const isRef = this._graphPanelParameters?.refName || "";

                const isJump2Function =
                    this._graphFunction?.isJump2Function ?? false;
                const isJump2File = this._graphFunction?.isJump2File ?? false;
                const isGenerateReferenceGraph =
                    this._graphFunction?.isGenerateReferenceGraph ?? false;
                const isGenerateOutgoingGraph =
                    this._graphFunction?.isGenerateOutgoingGraph ?? false;
                const isCopyFunction =
                    this._graphFunction?.isCopyFunction ?? false;
                const isJumpToTheFirstReference =
                    this._graphFunction?.isJumpToTheFirstReference ?? false;
                const isGenerateReferenceGraphForThisFile =
                    this._graphFunction?.isGenerateReferenceGraphForThisFile ??
                    false;
                const isGenerateReferenceGraphForAllFiles =
                    this._graphFunction?.isGenerateReferenceGraphForAllFiles ??
                    false;
                const isCopyFunctionInRefGraph =
                    this._graphFunction?.isCopyFunctionInRefGraph ?? false;
                const isCopyFilePath =
                    this._graphFunction?.isCopyFilePath ?? false;
                const isExportCallGraphToCSV =
                    this._graphFunction?.isExportCallGraphToCSV ?? false;
                const isExportCallGraphToSVG =
                    this._graphFunction?.isExportCallGraphToSVG ?? false;
                const isIncomeGraph = this._graphType === GraphType.Incoming;

                const isCursorIDE = this._isCursorIDE;
                // const isShowGenerateReferenceGraph =
                //     this._graphPanelParameters?.isShowGenerateReferenceGraphFlag ?? false;
                // const isShowGenerateOutgoingGraph =
                //     this._graphPanelParameters?.isShowGenerateOutgoingGraphFlag ?? false;
                this._panel.webview.html = `
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                        <meta charset="UTF-8">
                        <meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}';">
                        
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style id="crabviz_style">
                            ${cssVariables.toString()}
                            ${cssStyles.toString()}
                             /* 下部分新增：让搜索栏浮在svg上方 background:gba(245,255,250,1);*/
                            #search-bar {
                                position: fixed;
                                top: 4px;
                                left: 4px;
                                z-index: 1000;
                                background: transparent;
                                padding: 0;
                                border-radius: 8px;

                                display: flex;
                                gap: 8px;
                                align-items: center;
                            }
                            body {
                                position: relative;
                                min-height: 100vh;
                            }
                        </style>
                        <title>${isRef ? isRef : "funcCallGraph"}</title>

                        <!-- 在这里插入 VSCode API 实例化 -->
                        <script nonce="${nonce}">
                           window.vscode = window.acquireVsCodeApi();
                        </script>

                        </head>

                        ${svg}
                        <body data-graph-type="${this._graphType}" data-vscode-context='{ "preventDefaultContextMenuItems": true }'>
                        <div id="search-bar">
                            <div class="search-input-container" style="display: flex; align-items: center; position: relative; background: rgba(245,255,250,1); border-radius: 4px; border: 1.5px solid #000000; width: 271px; height: 31px; padding: 0 6px; box-sizing: border-box; overflow: hidden;">
                                <input id="searchBox" type="text" placeholder="" maxlength="200" style="margin:0;padding:4px ;background: transparent;border: none;outline: none;min-width:120px;vertical-align: top;flex:1;" />
                                <span id="search-result-count" class="search-result-count" style="display: none;position:static; margin-left: 1px;margin-top:0px; font-size: 13px; color: #666; background: none; white-space: nowrap;">0/0</span>
                                <div style="display: flex; align-items: center; gap: 2px; margin-left: 6px;">
                                    <button id="search-up-btn" class="search-nadding: 5av-btn" 
                                            style="display: none; vertical-align: middle; 5px 4px; border: none; background: transparent; border-radius: 3px; cursor: pointer; color: #666;" 
                                            title="Previous result">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                            <path d="M4 10l4-4 4 4" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                    <button id="search-down-btn" class="search-nav-btn" 
                                            style="display: none; vertical-align: middle; padding: 5px 4px; border: none; background: transparent; border-radius: 3px; cursor: pointer; color: #666;" 
                                            title="Next result">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                            <path d="M4 6l4 4 4-4" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <button id="searchBtn" class="searchBtn" style="margin:1px;padding:4px;border: 1.5px solid #767676;border-radius:3px;">Search</button>
                            <button id="resetBtn" class="searchBtn" style="margin:1px;padding:4px;border: 1.5px solid #767676;border-radius:3px;">Reset</button>

                            ${
                                isIncomeGraph
                                    ? `
                            <div style ="margin-left: 30px">
                              <label style="margin-left:20px;font-size:15px;color:black;font-weight:400;">
                                    Max Incoming Levels:&nbsp;
                                    <input id="incoming-level-input" 
                                        type="number" 
                                        value="${this._incomingLevelValue}"
                                        placeholder="16"
                                        min="4"
                                        max="32"
                                        style="
                                            margin:0;
                                            padding:0 4px;
                                            height:28px;
                                            line-height:31px;
                                            box-sizing:border-box;
                                            border: 1.5px solid #767676;
                                            border-radius:3px;
                                            width:40px;
                                            text-align:center;
                                            background: transparent;
                                        "
                                        oninput="this.value = this.value.replace(/[^0-9]/g, '')"
                                    />
                                </label>
                                <button id="apply-incoming-level" class="searchBtn" style="margin:1px;padding:4px;border: 1.5px solid #767676;border-radius:3px;">Apply</button>
                                </div>
                            `
                                    : ""
                            }
                        </div>
                            
                        <script nonce="${nonce}">
                             window.currentDot = \`${dot || ""}\`;
                             // 等待SVG节点插入后再通知后端
                             document.addEventListener("DOMContentLoaded", function() {
                                 setTimeout(function() {
                                     if (window.vscode) {
                                         window.vscode.postMessage({
                                             command: "SVG_RENDERED",
                                             data: "${this._currentExpandedNode || ""}"
                                         });
                                         // console.log("SVG rendering is complete, node:", "${this._currentExpandedNode || ""}");
                                     }
                                 }, 50);

                                 // switch view按钮功能与右键菜单一致,文本根据视图类型动态变化
                                 const solidBtn = document.getElementById("solidViewBtn");
                                 if (solidBtn) {
                                     solidBtn.addEventListener("click", function() {
                                         if (window.vscode) {
                                             // 判断当前视图类型，切换到另一种
                                             const isComplete = ${this._graphPanelParameters?.is_complete_graph ? "true" : "false"};
                                             const nextType = isComplete ? 0 : 1;
                                             window.vscode.postMessage({
                                                 command: "EVENT_SWITCH_GRAPH_VIEW",
                                                 graphType: nextType
                                             });
                                             // 切换后立即更新按钮文本
                                             solidBtn.textContent = isComplete ? "Full View" : "Simple View";
                                         }
                                     });
                                 }
                             });
                        </script>
                        <!-- SVG_RENDERED 由前端DOM渲染完成后主动发送 -->


                        <!-- 节点菜单 -->
                        <div id="context-menu-node" class="context-menu" style="display: none;">
                            ${
                                isJump2Function
                                    ? `<div class="menu-item" data-action="EVENT_JUMP2CODE">
                                            Jump To The Function
                                        </div>`
                                    : ""
                            }
                            ${
                                isJump2File
                                    ? `<div class="menu-item" data-action="EVENT_JUMP2CODE">
                                            Jump To The File
                                        </div>`
                                    : ""
                            }
                            ${
                                isGenerateReferenceGraph
                                    ? `<div class="menu-item" data-action="EVENT_REF_CALL_GRAPH">
                                        Generate Reference Graph
                                        </div>`
                                    : ""
                            }

                            ${
                                isGenerateOutgoingGraph
                                    ? `<div class="menu-item" data-action="EVENT_OUTGOING_CALL_GRAPH">
                                        Generate Outgoing Call Graph
                                        </div>`
                                    : ""
                            } 
                            ${
                                isCopyFunction
                                    ? `<div class="menu-item" data-action="EVENT_COPY">
                                        Copy Function <span class="shortcut">Ctrl+C</span>
                                        </div>`
                                    : ""
                            }
                        </div>

                        <div id="context-menu-node-ref-first" class="context-menu" style="display: none;">

                            ${
                                isJumpToTheFirstReference
                                    ? `<div class="menu-item" data-action="EVENT_JUMP2CODE">
                                            Jump To The First Reference
                                        </div>`
                                    : ""
                            }
                            ${
                                isGenerateReferenceGraphForThisFile
                                    ? `<div class="menu-item" data-action="EVENT_REF_CALL_GRAPH">
                                        Generate Reference Graph for This File
                                        </div>`
                                    : ""
                            }
                            ${
                                isGenerateReferenceGraphForAllFiles
                                    ? `<div class="menu-item" data-action="EVENT_REF_CALL_GRAPH_ALL_FILES">
                                        Generate Reference Graph for All Files
                                        </div>`
                                    : ""
                            }
                            ${
                                isCopyFunctionInRefGraph
                                    ? `<div class="menu-item" data-action="EVENT_COPY">
                                        Copy Function <span class="shortcut">Ctrl+C</span>
                                        </div>`
                                    : ""
                            }
                        </div>
                        <!-- 节点菜单 -->

                        <!-- Cluster 菜单 -->

                        <div id="context-menu-cluster" class="context-menu" style="display: none;">
                        ${
                            isCopyFilePath
                                ? `<div class="menu-item" data-action="EVENT_COPY_FILE_PATH">
                                          Copy File Path <span class="shortcut">Ctrl+C</span>
                                        </div>`
                                : ""
                        }
                        </div>


                        <!-- 空白区域菜单 -->
                        <!-- 空白区域菜单 -->
                        <div id="context-menu-blank" class="context-menu" style="display: none;">
                            ${
                                isRef
                                    ? ""
                                    : `
                                ${
                                    isExportCallGraphToCSV
                                        ? `<div class="menu-item" data-action="EVENT_EXPORT_CSV">

                                            Export Call Graph To CSV
                                        </div>`
                                        : ""
                                }
                                `
                            }
                                ${
                                    isExportCallGraphToSVG
                                        ? `<div class="menu-item" data-action="EVENT_EXPORT_SVG">
                                            Export Call Graph To SVG
                                        </div>`
                                        : ""
                                }
                        </div>
                        ${scripts
                            .map(
                                (s) =>
                                    `<script nonce="${nonce}">${s.toString()}</script>`,
                            )
                            .join("\n")}


                        </body>
                        </html>`;
            },
        );
    }
    public showFuncOutgoingCallTree(json: string) {
        CallGraphPanel.currentPanel = this;
        const nonce = getNonce();
        // 解析json，获取根节点唯一id
        let rootId = "default";
        let data: any;
        try {
            data = JSON.parse(json);
            if (data && data.item) {
                const name = data.item.name || "";
                const path =
                    data.item.uri && data.item.uri.path
                        ? data.item.uri.path
                        : "";
                let pos = "";
                if (data.item.range) {
                    if (Array.isArray(data.item.range) && data.item.range[0]) {
                        pos = `@${data.item.range[0].line}:${data.item.range[0].character}`;
                    } else if (data.item.range.start) {
                        pos = `@${data.item.range.start.line}:${data.item.range.start.character}`;
                    }
                }
                // 增加唯一标识，确保每个 panel 隔离
                const uniquePanelId =
                    Date.now().toString() +
                    "_" +
                    Math.random().toString(36).substring(2, 8);
                rootId = `${name}@${path}${pos}__${uniquePanelId}`;
            }
        } catch {
            rootId = "default_" + Date.now().toString();
        }

        // 异步读取本地资源文件
        const resourceUri = vscode.Uri.joinPath(
            this._context.extensionUri,
            "tools",
            "outgoing_graph",
        );
        const pinImageUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(resourceUri, "pin.png"),
        );
        const pinFillImageUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(resourceUri, "pin-fill.png"),
        );
        const filePromises = ["styles.css", "event.js"].map((fileName) =>
            vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(resourceUri, fileName),
            ),
        );
        Promise.all(filePromises).then(([cssStyles, eventJs]) => {
            const isGenerateOutgoingGraphForThisNode =
                this._graphFunction?.isGenerateOutgoingGraphForThisNode ??
                false;
            const isExportCallGraphToCSV =
                this._graphFunction?.isExportCallGraphToCSV ?? false;
            const isExportCallGraphToSVG =
                this._graphFunction?.isExportCallGraphToSVG ?? false;
            this._panel.webview.html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Tree Graph</title>
                <style>
                    ${cssStyles.toString()}
                </style>
                </head>
                <body>
                    <div class="outgoing-toolbar">
                        <div id="search-bar">
                            <div class="search-input-container" style="display: flex; align-items: center; position: relative; background: rgba(245,255,250,1); border-radius: 4px; border: 1.5px solid #000000; min-width: 240px; padding: 0 6px;">
                                <input id="searchBox" type="text" placeholder="" maxlength="200" style="margin:0;padding:4px 0px 4px 2px;background: transparent;border: none;outline: none;min-width:120px;vertical-align: top;flex:1;" />
                                <span id="search-result-count" class="search-result-count" style="display: none;position:static; margin-left: 1px;margin-top:13px; font-size: 13px; color: #666; background: none; white-space: nowrap;">0/0</span>
                                <div style="display: flex; align-items: center; gap: 2px; margin-left: 6px;">
                                    <button id="search-up-btn" class="search-nav-btn" 
                                            style="display: none; vertical-align: middle; padding: 5px 4px; border: none; background: transparent; border-radius: 3px; cursor: pointer; color: #666;" 
                                            title="Previous result">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                            <path d="M4 10l4-4 4 4" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                    <button id="search-down-btn" class="search-nav-btn" 
                                            style="display: none; vertical-align: middle; padding: 5px 4px; border: none; background: transparent; border-radius: 3px; cursor: pointer; color: #666;" 
                                            title="Next result">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                            <path d="M4 6l4 4 4-4" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <button id="searchBtn" style="margin-top:0;vertical-align:top;cursor:pointer;">Search</button>
                            <button id="resetBtn" style="margin-top:0;vertical-align:top;cursor:pointer;">Reset</button>
                            <button id="expand-5" style="margin-top:0;vertical-align:top;margin-left:30px;cursor:pointer;">Expand All</button>
                            <button id="collapse-all" style="margin-top:0;vertical-align:top;cursor:pointer;">Collapse All</button>
                            <label style="margin-left:8px;font-size:14px;color:black;font-weight:500;font-family:Consolas, monospace;">Show Levels:
                                <select class="outgoing-select" id="select-depth" style="height:25px;min-width:90px;font-size:14px;border-radius:4px;border:1.5px solid #000;background:#f5faff;font-weight:500;outline:none;cursor:pointer;margin-left:4px;">
                                    <option value="1" selected>1 Level</option>
                                </select>
                            </label>
                            <button id="show-pins-btn" style="margin-left:30px;">Show Pins</button>
                            <button id="reset-pins-btn" style="margin-left:8px;">Reset Pins</button>
                        </div>
                    </div>
                    <ul id="tree-root" class="tree"></ul>
                    <div id="context-menu-blank" class="context-menu">
                        <div class="menu-item" id="export-csv">Export Call Graph To CSV</div>
                        <div class="menu-item" id="export-svg">Export Call Graph To SVG</div>
                    </div>
                    <div id="context-menu-outgoing-node" class="context-menu" style="display: none;">
                    ${
                        isGenerateOutgoingGraphForThisNode
                            ? `<div class="menu-item" data-action="EVENT_OUTGOING_REGENERATE">
                                        Generate Outgoing Graph for This Node
                                    </div>`
                            : ""
                    }
                    ${
                        isExportCallGraphToCSV
                            ? `<div class="menu-item" data-action="EVENT_EXPORT_SVG">
                                        Export Call Graph To SVG
                                    </div>`
                            : ""
                    }
                    ${
                        isExportCallGraphToSVG
                            ? `<div class="menu-item" data-action="EVENT_EXPORT_CSV">
                                        Export Call Graph To CSV
                                    </div>`
                            : ""
                    }
                    </div>
                    <script nonce="${nonce}">
                        window.CallGraphInit = {
                            treeData: ${JSON.stringify(data)},
                            rootId: ${JSON.stringify(rootId)},
                            pinImageUri: "${pinImageUri}",
                            pinFillImageUri: "${pinFillImageUri}",
                            filterConfig: ${JSON.stringify(this.getFilterConfig())},
                        };
                    </script>
                    <script nonce="${nonce}">
                        ${eventJs.toString()}
                    </script>
                </body>
                </html>`;
        });
    }

    saveSVG(svg: string) {
        const writeData = Buffer.from(svg, "utf8");
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const defaultPath = workspaceFolder
            ? vscode.Uri.joinPath(
                  workspaceFolder.uri,
                  `${this._panel.title}.svg`,
              )
            : vscode.Uri.file(`${this._panel.title}.svg`);
        vscode.window
            .showSaveDialog({
                defaultUri: defaultPath,
                saveLabel: "Export SVG",
                filters: { Images: ["svg"] },
            })
            .then((fileUri) => {
                if (fileUri) {
                    try {
                        vscode.workspace.fs.writeFile(fileUri, writeData).then(
                            () => {
                                vscode.window.showInformationMessage(
                                    `✅ SVG exported: ${fileUri.fsPath}`,
                                );
                            },
                            (err: any) => {
                                vscode.window.showErrorMessage(
                                    `Error on writing file: ${err}`,
                                );
                            },
                        );
                    } catch (err) {
                        vscode.window.showErrorMessage(
                            `Error on writing file: ${err}`,
                        );
                    }
                }
            });
    }
    saveCSV(graph: CallHierarchyNode) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const defaultPath = workspaceFolder
            ? vscode.Uri.joinPath(
                  workspaceFolder.uri,
                  `${this._panel.title}.csv`,
              )
            : vscode.Uri.file(`${this._panel.title}.csv`);
        vscode.window
            .showSaveDialog({
                defaultUri: defaultPath,
                saveLabel: "Export CSV",
                filters: { CSV: ["csv"] },
            })
            .then((fileUri) => {
                if (fileUri) {
                    try {
                        const csvData = generateCallGraphCSV(graph); // 返回的是 Uint8Array
                        vscode.workspace.fs.writeFile(fileUri, csvData).then(
                            () => {
                                vscode.window.showInformationMessage(
                                    `✅ CSV exported: ${fileUri.fsPath}`,
                                );
                            },
                            (err: any) => {
                                vscode.window.showErrorMessage(
                                    `❌ Error writing file: ${err}`,
                                );
                            },
                        );
                    } catch (err) {
                        vscode.window.showErrorMessage(
                            `❌ Error exporting CSV: ${err}`,
                        );
                    }
                }
            });
    }

    protected async jumpToCode(file_path: string) {
        const config = vscode.workspace.getConfiguration();
        if (this._graphType === GraphType.Outgoing) {
        } else if (this._graphType === GraphType.OutgoingTree) {
        } else if (this._graphType === GraphType.Incoming) {
        } else if (this._graphType === GraphType.Reference) {
            if (
                this._graphPanelParameters?.refName &&
                this._graphPanelParameters?.refName.trim() !== "" &&
                file_path.includes("line")
            ) {
            } else if (
                this._graphPanelParameters?.refName &&
                this._graphPanelParameters?.refName.trim() !== ""
            ) {
                // if (enableDeepDive) {
                //     addUserOpStats(
                //         FUNCTIONS.FUNC_REF_GRAPH,
                //         ACTIONS.ACT_GENERATE_FROM_REFERENCE_GRAPH,
                //     );
                // }
            }
        }

        let temp_file_path = file_path;

        // 判断是否同时包含 "#" 和 "line"
        if (temp_file_path.includes("#") && temp_file_path.includes("line")) {
            const [beforeSharp] = temp_file_path.split("#");
            const afterSharp = temp_file_path.substring(
                temp_file_path.indexOf("#") + 1,
            );

            const lineMatch = afterSharp.match(
                /\d*\.?line (\d+):(\d+)~(\d+):(\d+)/,
            );
            if (lineMatch) {
                const line = parseInt(lineMatch[3], 10);
                let column = parseInt(lineMatch[4], 10);
                column += 2; // adjust class"::"
                temp_file_path = `${beforeSharp}#@${line}:${column}`;
            } else {
                // 再尝试匹配 "@xxx:xx"
                const match = afterSharp.match(/@(\d+):(\d+)/);
                if (match) {
                    const line = match[1];
                    const column = match[2];
                    temp_file_path = `${beforeSharp}#@${line}:${column}`;
                } else {
                    temp_file_path = `${beforeSharp}#@0:0`;
                }
            }
        }
        //-------------------------------
        // 新增：如果没有#，说明只有文件路径，直接跳转到第一行
        if (!temp_file_path.includes("#")) {
            const uri = vscode.Uri.file(temp_file_path);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(0, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
            return;
        }
        //-------------------------------
        const [filePathWithAnchor] = temp_file_path.split('"');

        const [filePath, anchor] = filePathWithAnchor.split("#");
        if (!filePath || !anchor) {
            // 新增兜底：如果没有anchor，也直接跳到文件首行
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(0, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
            return;
        }
        const match = anchor.match(/@(\d+):(\d+)/);
        const line = match ? parseInt(match[1], 10) - 1 : 0;
        const char = match ? parseInt(match[2], 10) : 0;
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const pos = new vscode.Position(line, char);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos));

    }

    protected async refFuncMultipleCallGraph(title: string) {
        // console.log(title);
        // console.log(uri2RangesMap);
        if (!this._context) {
            return;
        }
        let managerRefCallGraph = new CallGraphEntry(this._context);
        managerRefCallGraph.generateMultipleRefCallGraph(
            // this._overLimtMap,
            title,
            this._graphPanelParameters?.refName ?? "",
        );
    }
    protected async regenerateOutgoingGraph(item: any) {
        if (!this._context || !item) {
            return;
        }
        let manager = new CallGraphEntry(this._context);
        if (item) {
            await manager.generateFuncOutgoingTreeCallGraph([item]);
        }
    }

    protected async allFilesCallGraph(
        uri2RangesMap: Map<string, vscode.Range[]>,
    ) {
        if (!this._context) {
            return;
        }
        let managerRefCallGraph = new CallGraphEntry(this._context);
        managerRefCallGraph.generateAllFilesCallGraph(
            // this._overLimtMap,
            uri2RangesMap,
            this._graphPanelParameters?.refName ?? "",
        );
    }

    /**
     * 切换图形视图类型(简化视图/完整视图)
     * @param graphType 图形类型: 0=简化图(虚线), 1=完整图(实线)
     */
    /**
     * 获取当前的过滤配置，用于生成缓存键
     * 这个方法返回影响节点过滤的所有配置信息，与 node_graph.ts 中的过滤逻辑保持一致
     */
    protected getFilterConfig(): any {
        const config = vscode.workspace.getConfiguration("Synapse");

        // 获取黑名单配置，与 node_graph.ts 中的 getCallGraphBlacklists() 保持一致
        const funcListRaw: string[] = config.get(
            "callGraphFunctionBlacklist",
            [],
        );
        const classListRaw: string[] = config.get(
            "callGraphClassBlacklist",
            [],
        );
        const pathListRaw: string[] = config.get("callGraphPathBlacklist", []);

        // 处理分号分隔的配置项
        const funcList = funcListRaw.flatMap((item) =>
            item
                .split(";")
                .map((s) => s.trim())
                .filter(Boolean),
        );
        const classList = classListRaw.flatMap((item) =>
            item
                .split(";")
                .map((s) => s.trim())
                .filter(Boolean),
        );
        const pathList = pathListRaw.flatMap((item) =>
            item
                .split(";")
                .map((s) => s.trim())
                .filter(Boolean),
        );

        return {
            // 核心过滤配置 - 与 node_graph.ts 中的过滤逻辑对应
            funcBlacklist: funcList,
            classBlacklist: classList,
            pathBlacklist: pathList,

            // 其他可能影响过滤的配置
            graphType: this._graphType,
            isCompleteGraph: this._graphPanelParameters?.is_complete_graph,

            // 配置版本标识，确保配置变化时缓存失效
            configVersion: Date.now(),
        };
    }
} //8.29

// DOT 合并工具
function mergeDot(originalDot: string, nodeDot: string): string {
    const originalBody = originalDot
        .replace(/^digraph\s*\{/, "")
        .replace(/\}$/, "");
    const nodeBody = nodeDot.replace(/^digraph\s*\{/, "").replace(/\}$/, "");
    return `digraph {${originalBody}\n${nodeBody}\n}`;
}

function getNonce() {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// 提取函数参数的辅助函数
async function extractFunctionParameters(
    item: vscode.CallHierarchyItem,
): Promise<string> {
    try {
        // 检查必要的属性是否存在
        if (!item || !item.uri || !item.range) {
            return "";
        }

        const document = await vscode.workspace.openTextDocument(item.uri);
        const range = item.range;

        // 检查 range.start 是否存在
        if (!range.start || typeof range.start.line !== "number") {
            return "";
        }

        // 获取函数定义所在的行及后续几行
        let startLine = range.start.line;
        let endLine = Math.min(startLine + 5, document.lineCount - 1); // 最多向下查找5行

        let fullText = "";
        for (let i = startLine; i <= endLine; i++) {
            fullText += document.lineAt(i).text + "\n";
        }

        // 使用正则表达式提取函数参数
        // 匹配函数名后面的括号内容，支持多行参数
        let functionName = "";
        if (item.name && typeof item.name === "string") {
            const parts = item.name.split("::");
            functionName =
                parts.length > 0 ? parts.pop() || item.name : item.name;
        }

        // 检查函数名是否有效
        if (!functionName || typeof functionName !== "string") {
            return "";
        }

        // 构建正则表达式来匹配函数声明，安全地转义特殊字符
        const escapedFunctionName = functionName.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
        );
        const funcRegex = new RegExp(
            `${escapedFunctionName}\\s*\\((.*?)\\)`,
            "gs",
        );

        const match = funcRegex.exec(fullText);
        if (match && match[1] !== undefined) {
            let params = match[1].trim();

            // 确保 params 是字符串，防止 replace 调用失败
            if (typeof params !== "string") {
                return "";
            }

            // 清理参数字符串，移除多余的空白和换行
            params = params
                .replace(/\s*\n\s*/g, " ") // 将换行替换为空格
                .replace(/\s+/g, " ") // 合并多个空格
                .trim();

            // 如果参数为空，返回空字符串
            if (!params || params === "void") {
                return "";
            }

            return params;
        }

        return "";
    } catch (error) {
        Log.error(`Error extracting parameters for ${item.name}: ${error}`);
        return "";
    }
}
