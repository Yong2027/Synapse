import * as vscode from "vscode";
import { Range } from "vscode";
import { generateDot, generateOutgoingDot } from "./node_incoming_dot";
import { Log } from "../util/logger";
import { getFuncCallNodeGraph } from "./node_graph";
// @ts-ignore - ESM module handled by esbuild
import { instance as vizInstance } from "@viz-js/viz";
import { CallGraphPanel, GraphType } from "./webview";
import { CallHierarchyNode } from "./node_graph";
import { generateReferDot, generateReferOverLimitDot } from "./node_ref_dot";
import { generateMultipleReferDot } from "./node_ref_dot";
import { parseCallLocations } from "./utils/common";
import { parseUri2RangesMapToLocations } from "./utils/common";
import { getReferenceWordInfo } from "./utils/common";
import { getReferFuncWithRange } from "./utils/common";
import { OUTGOING_CALL_GRAPH_MAX_DEPTH, CALL_GRAPH_MAX_DEPTH } from "../config";
import { GraphPanelFunction, GraphPanelParameters } from "./webview";
import {
    getFirstGraphGenerationFlg,
    setFirstGraphGenerationFlg,
} from "./node_graph";

async function getActiveEditor(): Promise<vscode.TextEditor | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return null;
    }
    return editor;
}

const viz = vizInstance();
const renderOptions = { format: "svg" };
export const output = vscode.window.createOutputChannel("CallGraph");

export const generateFuncIncomingGraph = (
    context: vscode.ExtensionContext,
    refCallHierarchyItems?: vscode.CallHierarchyItem[],
) => {
    return async () => {
        let callHierarchyItems: vscode.CallHierarchyItem[] = [];
        // _ref_nodes: ReferNode[] = [];
        let log_message = "";
        Log.info("Start to generate Incoming Graph...");
        if (refCallHierarchyItems && refCallHierarchyItems[0]) {
            callHierarchyItems[0] = refCallHierarchyItems[0];
        } else {
            const editor = await getActiveEditor();
            if (!editor) {
                Log.warn("No active file!");
                return;
            }

            // 获取当前位置
            let selectedPosition = editor.selection.active;

            // 检查上一行是否包含 "template <"
            if (selectedPosition.line > 0) {
                const previousLine = editor.document.lineAt(
                    selectedPosition.line - 1,
                ).text;
                const templateRegex = /template\s+<.*?>/;
                const templateFunctionRegex = /<.*?>/;
                const isCPPFile = editor.document.uri.path.endsWith(".cpp");
                if (
                    templateRegex.test(previousLine) &&
                    templateFunctionRegex.test(
                        editor.document.lineAt(selectedPosition.line).text,
                    ) &&
                    isCPPFile
                ) {
                    // 上移一行，列号改为0
                    selectedPosition = new vscode.Position(
                        selectedPosition.line - 1,
                        0,
                    );
                    Log.debug("Detected template declaration.");
                }
            }

            callHierarchyItems = await vscode.commands.executeCommand(
                "vscode.prepareCallHierarchy",
                editor.document.uri,
                selectedPosition,
            );

            if (!callHierarchyItems || !callHierarchyItems[0]) {
                vscode.window.showErrorMessage(
                    "Error occurred while parsing the selected code!",
                );
                Log.error("Can't resolve entry function");
                return;
            }
        }

        // === 构建代码调用树形结构图 ===
        const graph: CallHierarchyNode = await getFuncCallNodeGraph(
            callHierarchyItems[0],
            false,
            false,
            CALL_GRAPH_MAX_DEPTH,
        );
        if (!graph) {
            log_message = `[ERROR] Failed to generate func incomingcall graph.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generate func incoming call graph.");
        }

        // === 生成 DOT ===
        const callNodeGrapHDot = generateDot(graph).toString();
        if (!callNodeGrapHDot) {
            log_message = `[ERROR] Failed to generate dot file.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generate dot file.");
        }
        // === DOT 渲染成为 SVG ===
        viz.then((viz) =>
            viz.renderString(callNodeGrapHDot, renderOptions),
        ).then((svg) => {
            if (!svg) {
                log_message = `[ERROR] Failed to generate svg.`;
                Log.info(log_message);
                return;
            }
            let showFunction: GraphPanelFunction = {};
            showFunction.isCopyFunction = true;
            showFunction.isJump2Function = true;
            showFunction.isCopyFilePath = true;
            showFunction.isExportCallGraphToCSV = true;
            showFunction.isExportCallGraphToSVG = true;
            const panel = new CallGraphPanel(
                context,
                GraphType.Incoming,
                graph,
                showFunction,
            );
            // ===  SVG 展示到页面上 ===
            panel.showCallGraph(svg, true);
        });
    };
};
export const generateFuncOutgoingTreeGraph = (
    context: vscode.ExtensionContext,
    refCallHierarchyItems?: vscode.CallHierarchyItem[],
) => {
    return async () => {
        let callHierarchyItems: vscode.CallHierarchyItem[] = [];
        // _ref_nodes: ReferNode[] = [];
        let log_message = "";
        Log.info("Start to generate Outgoing Graph...");
        if (refCallHierarchyItems && refCallHierarchyItems[0]) {
            // 保证 refCallHierarchyItems[0] 是 VSCode 实例
            const item = refCallHierarchyItems[0];
            let entryItem = item;
            if (item && item.uri && item.range && Array.isArray(item.range)) {
                const uri =
                    typeof item.uri === "string"
                        ? vscode.Uri.parse(item.uri)
                        : vscode.Uri.file(item.uri.fsPath || item.uri.path);
                const pos = new vscode.Position(
                    item.range[0].line,
                    item.range[0].character,
                );
                const items = await vscode.commands.executeCommand<
                    vscode.CallHierarchyItem[]
                >("vscode.prepareCallHierarchy", uri, pos);
                if (items && items.length > 0) {
                    entryItem = items[0];
                }
            }
            callHierarchyItems[0] = entryItem;
        } else {
            const editor = await getActiveEditor();
            if (!editor) {
                Log.warn("No active file!");
                return;
            }
            //对模板函数的特殊处理
            let selectedPosition = editor.selection.active;
            if (selectedPosition.line > 0) {
                const previousLine = editor.document.lineAt(
                    selectedPosition.line - 1,
                ).text;
                const templateRegex = /template\s+<.*?>/;
                const templateFunctionRegex = /<.*?>/;
                const isCPPFile = editor.document.uri.path.endsWith(".cpp");
                if (
                    templateRegex.test(previousLine) &&
                    templateFunctionRegex.test(
                        editor.document.lineAt(selectedPosition.line).text,
                    ) &&
                    isCPPFile
                ) {
                    // 上移一行，列号改为0
                    selectedPosition = new vscode.Position(
                        selectedPosition.line - 1,
                        0,
                    );
                    Log.debug("Detected template declaration.");
                }
            }
            callHierarchyItems = await vscode.commands.executeCommand(
                "vscode.prepareCallHierarchy",
                editor.document.uri,
                selectedPosition,
            );

            if (!callHierarchyItems || !callHierarchyItems[0]) {
                vscode.window.showErrorMessage(
                    "Error occurred while parsing the selected code!",
                );
                Log.error("Can't resolve entry function");
                return;
            }
        }

        // === 构建代码调用树形结构图 ===
        const graph: CallHierarchyNode = await getFuncCallNodeGraph(
            callHierarchyItems[0],
            true,
            true,
            6,
            undefined, // 新增
        );
        if (!graph) {
            log_message = `[ERROR] Failed to generate outgoing call graph.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generate func outgoing call graph.");
        }
        let showFunction: GraphPanelFunction = {};
        showFunction.isCopyFunction = true;
        showFunction.isJump2Function = true;
        showFunction.isGenerateOutgoingGraphForThisNode = true;
        showFunction.isExportCallGraphToCSV = true;
        showFunction.isExportCallGraphToSVG = true;
        const panel = new CallGraphPanel(
            context,
            GraphType.OutgoingTree,
            graph,
            showFunction,
        );
        // ===  SVG 展示到页面上 ===
        panel.showFuncOutgoingCallTree(JSON.stringify(graph));
    };
};

// 递归遍历调用层级关系（打印）
// export function logNodeNames(node: CallHierarchyNode, depth: number = 0) {
//     const indent = "  ".repeat(depth);
//     Log.info(`显示层级关系: ${indent}${node.item.name}`);
//     for (const child of node.children) {
//         logNodeNames(child, depth + 1);
//     }
// }

export const generateFuncOutgoingGraph = (
    context: vscode.ExtensionContext,
    refCallHierarchyItems?: vscode.CallHierarchyItem[],
    showmaxDepth: number = OUTGOING_CALL_GRAPH_MAX_DEPTH, // 默认显示3层，(根节点+2)总共3层
) => {
    return async () => {
        let callHierarchyItems: vscode.CallHierarchyItem[] = [];
        let log_message = "";
        Log.info("Start to generate Outgoing Graph...");
        if (refCallHierarchyItems && refCallHierarchyItems[0]) {
            callHierarchyItems[0] = refCallHierarchyItems[0];
        } else {
            const editor = await getActiveEditor();
            if (!editor) {
                Log.warn("No active file!");
                return;
            }
            //对模板函数的特殊处理
            let selectedPosition = editor.selection.active;
            if (selectedPosition.line > 0) {
                const previousLine = editor.document.lineAt(
                    selectedPosition.line - 1,
                ).text;
                const templateRegex = /template\s+<.*?>/;
                const templateFunctionRegex = /<.*?>/;
                const isCPPFile = editor.document.uri.path.endsWith(".cpp");
                if (
                    templateRegex.test(previousLine) &&
                    templateFunctionRegex.test(
                        editor.document.lineAt(selectedPosition.line).text,
                    ) &&
                    isCPPFile
                ) {
                    // 上移一行，列号改为0
                    selectedPosition = new vscode.Position(
                        selectedPosition.line - 1,
                        0,
                    );
                    Log.debug("Detected template declaration.");
                }
            }
            callHierarchyItems = await vscode.commands.executeCommand(
                "vscode.prepareCallHierarchy",
                editor.document.uri,
                selectedPosition,
            );

            if (!callHierarchyItems || !callHierarchyItems[0]) {
                vscode.window.showErrorMessage(
                    "Error occurred while parsing the selected code!",
                );
                Log.error("Can't resolve entry function");
                return;
            }
        }

        // === 构建代码调用树形结构图 ===
        const graph: CallHierarchyNode = await getFuncCallNodeGraph(
            callHierarchyItems[0],
            true,
            false, //新增
            undefined, // 新增
            showmaxDepth, //构建树形结构图也只构建3层，根节点+2
        );
        // 在你的异步函数里调用
        // logNodeNames(graph);
        if (!graph) {
            log_message = `[ERROR] Failed to generate func call graph.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generate func call graph.");
        }
        // Log.info("graph:"+graph);
        // Log.info("graph:"+JSON.stringify(graph));
        // === 生成 DOT ===
        const callNodeGrapHDot = generateOutgoingDot(
            graph,
            showmaxDepth,
        ).toString();
        if (!callNodeGrapHDot) {
            log_message = `[ERROR] Failed to generate dot file.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generate dot file.");
        }

        // === DOT 渲染成为 SVG ===
        viz.then((viz) =>
            viz.renderString(
                unifyDotLabelEllipsis(callNodeGrapHDot),
                renderOptions,
            ),
        ).then((svg) => {
            if (!svg) {
                log_message = `[ERROR] Failed to generate svg.`;
                Log.info(log_message);
                return;
            }

            // 在每个函数节点的右侧添加一个圆圈和加号 +
            svg = addCirclePlusToEllipsisNodes(svg, new Map());

            let showFunction: GraphPanelFunction = {};
            showFunction.isGenerateOutgoingGraph = true;
            showFunction.isCopyFunction = true;
            showFunction.isJump2Function = true;
            showFunction.isCopyFilePath = true;
            showFunction.isExportCallGraphToCSV = true;
            showFunction.isExportCallGraphToSVG = true;

            const panel = new CallGraphPanel(
                context,
                GraphType.Outgoing,
                graph,
                showFunction,
            );
            // ===  SVG 展示到页面上 ===
            // Log.info("当前第一处DOT片段：" + callNodeGrapHDot);
            panel.showCallGraph(svg, true, callNodeGrapHDot);
        });
    };
};

export const generateFuncOutgoingGraphInSvg = (
    context: vscode.ExtensionContext,
    refCallHierarchyItems?: vscode.CallHierarchyItem[],
    showmaxDepth: number = OUTGOING_CALL_GRAPH_MAX_DEPTH, // 默认显示3层，(根节点+2)总共3层
) => {
    return async () => {
        let callHierarchyItems: vscode.CallHierarchyItem[] = [];
        let log_message = "";
        Log.info("Start to generate Outgoing Graph...");
        if (refCallHierarchyItems && refCallHierarchyItems[0]) {
            callHierarchyItems[0] = refCallHierarchyItems[0];
        } else {
            const editor = await getActiveEditor();
            if (!editor) {
                Log.warn("No active file!");
                return;
            }
            // 获取当前位置
            let selectedPosition = editor.selection.active;

            // 检查上一行是否包含 "template <"
            if (selectedPosition.line > 0) {
                const previousLine = editor.document.lineAt(
                    selectedPosition.line - 1,
                ).text;
                const templateRegex = /template\s+<.*?>/;
                const templateFunctionRegex = /<.*?>/;
                const isCPPFile = editor.document.uri.path.endsWith(".cpp");
                if (
                    templateRegex.test(previousLine) &&
                    templateFunctionRegex.test(
                        editor.document.lineAt(selectedPosition.line).text,
                    ) &&
                    isCPPFile
                ) {
                    // 上移一行，列号改为0
                    selectedPosition = new vscode.Position(
                        selectedPosition.line - 1,
                        0,
                    );
                    Log.debug("Detected template declaration.");
                }
            }
            callHierarchyItems = await vscode.commands.executeCommand(
                "vscode.prepareCallHierarchy",
                editor.document.uri,
                selectedPosition,
            );

            if (!callHierarchyItems || !callHierarchyItems[0]) {
                vscode.window.showErrorMessage(
                    "Error occurred while parsing the selected code!",
                );
                Log.error("Can't resolve entry function");
                return;
            }
        }

        // === 构建代码调用树形结构图 ===
        const graph: CallHierarchyNode = await getFuncCallNodeGraph(
            // callHierarchyItems[0],
            // true,
            // showmaxDepth,
            callHierarchyItems[0],
            true,
            false, //新增
            undefined, // 新增
            showmaxDepth, //构建树形结构图也只构建3层，根节点+2
        );
        if (!graph) {
            log_message = `[ERROR] Failed to generate func call graph.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generate func call graph.");
        }
        //Log.info("graph:"+JSON.stringify(graph));

        // === 生成 DOT ===
        const callNodeGrapHDot = generateOutgoingDot(graph).toString();
        if (!callNodeGrapHDot) {
            log_message = `[ERROR] Failed to generate dot file.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generate dot file.");
        }

        Log.info("callNodeGrapHDot:" + callNodeGrapHDot);
        // === DOT 渲染成为 SVG ===
        viz.then((viz) =>
            viz.renderString(
                unifyDotLabelEllipsis(callNodeGrapHDot),
                renderOptions,
            ),
        ).then((svg) => {
            if (!svg) {
                log_message = `[ERROR] Failed to generate svg.`;
                Log.info(log_message);
                return;
            }
            let showFunction: GraphPanelFunction = {};
            showFunction.isGenerateOutgoingGraph = true;
            showFunction.isCopyFunction = true;
            showFunction.isJump2Function = true;
            showFunction.isCopyFilePath = true;
            showFunction.isExportCallGraphToCSV = true;
            showFunction.isExportCallGraphToSVG = true;
            const panel = new CallGraphPanel(
                context,
                GraphType.Outgoing,
                graph,
                showFunction,
            );
            // ===  SVG 展示到页面上 ===
            panel.showCallGraph(svg, true);
        });
    };
};

// 整体思想
// ----1.获取references集合 里面很多个引用位置 就是xxx.cpp哪里引用了
//     ---2.接下来分析每个xxx.cpp文档 我们要建立函数集合 函数集合有俩种 1.单纯函数列表 2.函数以及对应这个函数引用了几次  uri->range[]
// 	   ---3.然后就是通过上述获取的这俩个集合 先对单纯函数列表直接遍历 然后每个执行call graph 返回值是map集合 key:children(string类型)->value:father(string)
// 	       ---4.然后我们就拿到了所有的调用关系 开始构建dot文件 构建的时候我们只要判断一下 当前children/father 在不在第2步获得函数引用集合里面 就能知道是不是第一层函数 如果是就可以加上 ("引用次数")
// 		       ---dot文件生成 转svg展示 过程基本类似incoming 不做过多赘述
export const generateReferenceGraph = (context: vscode.ExtensionContext) => {
    return async () => {
        Log.info("Start to generate Reference Graph...");
        let log_message = "";

        // 获取当前活跃的编辑器
        const editor = await getActiveEditor();
        if (!editor) {
            Log.info("No active file!");
            return;
        }
        const document = editor.document;
        const position = editor.selection.active;
        let adjustedPosition = position;
        let wordRange = document.getWordRangeAtPosition(position);
        if (
            wordRange &&
            position.isAfterOrEqual(wordRange.end) &&
            position.character > 0
        ) {
            adjustedPosition = position.translate(0, -1);
        }
        if (getFirstGraphGenerationFlg()) {
            await vscode.commands.executeCommand<vscode.Location[]>(
                "vscode.executeReferenceProvider",
                document.uri,
                adjustedPosition,
            );
            await new Promise((resolve) => setTimeout(resolve, 5000));
            // 设置为false，表示预热已完成
            setFirstGraphGenerationFlg(false);
        }
        //  === 获取当前选中的reference的文本信息 ===
        const refInfo = getReferenceWordInfo(document, adjustedPosition);
        if (!refInfo) {
            log_message = `[ERROR] No reference word found at the current position.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generate func call graph.");
        }
        let { ref_word, ref_word_with_uri } = refInfo;

        // === 调用executeReferenceProvider接口 得到引用列表 references===
        Log.info("[INFO] Start to generate reference graph...");
        const references: vscode.Location[] =
            await vscode.commands.executeCommand<vscode.Location[]>(
                "vscode.executeReferenceProvider",
                document.uri,
                adjustedPosition,
            );
        if (!references) {
            log_message = `[ERROR] An error occurred when calling the executeReferenceProvider interface.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to vscode.executeReferenceProvider.");
        }

        // === 判断references长度 超过限定长度展示第一层图|没超过就一次性都展示 ===
        let callReferDot = ""; //dot文件 后续转svg用
        let is_complete_graph = false; // 是否是完整图 如果是完整图 后面不需要右键调用call graph了
        //  搞一个isShowGenerateReferenceGraphFlag
        let isShowGenerateReferenceGraphFlag = false;
        // if (references.length > REFER_CALL_GRAPH_CITATION_COUNT) {
        isShowGenerateReferenceGraphFlag = true;
        // === Map<string, vscode.Range[]>  uri-> range列表的集合 ===
        const { uri2RangesMap } = await buildUriToRangesMap(references);
        if (!uri2RangesMap) {
            log_message = `[ERROR] buildUriToRangesMap Failure.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to buildUriToRangesMap.");
        }
        //将显示的引用节点的索引号@row:col改变为行号显示@row+1:col
        ref_word_with_uri = ref_word_with_uri.replace(
            /@(\d+):(\d+)/,
            (_, line, col) => `@${parseInt(line) + 1}:${col}`,
        );
        // === 生成ReferOverLimitDot ===
        const { dotRefOverLimitGraph } = await generateReferOverLimitDot(
            uri2RangesMap,
            ref_word,
            ref_word_with_uri,
        );
        if (!dotRefOverLimitGraph) {
            log_message = `[ERROR] generateReferOverLimitDot Failure.`;
            Log.info(log_message);
            return;
        } else {
            Log.info("Success to generateReferOverLimitDot.");
        }

        callReferDot = dotRefOverLimitGraph.toString();
        if (!callReferDot) {
            Log.info("[ERROR] Failed to generateDot.");
        } else {
            Log.info("[SUCCESS] generateDot success");
        }
        // === DOT 渲染成为 SVG ===
        viz.then((viz) => viz.renderString(callReferDot, renderOptions)).then(
            (svg) => {
                if (!svg) {
                    vscode.window.showErrorMessage("No results");
                    Log.info("[ERROR]  Dot to Svg failed");
                    return;
                }
                let showFunction: GraphPanelFunction = {};
                showFunction.isGenerateReferenceGraphForThisFile = true;
                showFunction.isGenerateReferenceGraphForAllFiles = true;
                showFunction.isExportCallGraphToSVG = true;
                let panelParams: GraphPanelParameters = {};
                panelParams.refName = ref_word_with_uri;
                panelParams.is_complete_graph = is_complete_graph;
                panelParams.uri2RangesMap = uri2RangesMap;
                const panel = new CallGraphPanel(
                    context,
                    GraphType.Reference,
                    undefined,
                    showFunction,
                    panelParams,
                );
                // ===  SVG 展示到页面上 ===
                panel.showCallGraph(svg, true);
            },
        );
    };
};

import { processRefFunctions } from "./utils/common";
export const generateMultipleRefCallGraph = (
    context: vscode.ExtensionContext,
    title: string,
    ref_name_with_uri: string,
) => {
    return async () => {
        Log.info("Start to generate Multiple RefCallGraph...");
        // 解析 title 获取文件路径和函数名
        const [fileAndFunc, ...calls] = title.split("\n");
        const [file_path, funcWithPos] = fileAndFunc.split("#");
        const ref = vscode.Uri.file(file_path);
        const fileName = file_path.substring(file_path.lastIndexOf("/") + 1);
        // 获取函数集合 和 引用范围集合
        const locations: vscode.Location[] = parseCallLocations(ref, calls);
        // console.log(locations);
        const { ref_functions, ref_functions_map_range } =
            await getReferFuncWithRange(locations);

        if (ref_functions.length === 0) {
            vscode.window.showInformationMessage(
                "The current file has no function or method reference to the selected attribute",
            );
            return;
        }

        // 处理函数 获取函数的call graph集合
        let ref_callGraphs_map = new Map<string, Set<string>>();
        let processedMap = new Map<string, string>();

        await processRefFunctions(
            ref_functions,
            ref_callGraphs_map,
            processedMap,
        );

        const dotResult = await generateMultipleReferDot(
            ref_callGraphs_map,
            ref_name_with_uri,
            ref_functions_map_range,
        );

        let callReferDot = dotResult.dot.toString();
        if (!callReferDot) {
            Log.info("[ERROR] Failed to generateDot.");
        } else {
            Log.info("[SUCCESS] generateDot success");
        }

        viz.then((viz) => viz.renderString(callReferDot, renderOptions)).then(
            (svg) => {
                if (!svg) {
                    vscode.window.showErrorMessage("No results");
                    Log.info("[ERROR]  Dot to Svg failed");
                    return;
                }
                let showFunction: GraphPanelFunction = {};
                showFunction.isCopyFunction = true;
                showFunction.isJump2Function = true;
                showFunction.isJumpToTheFirstReference = true;
                showFunction.isCopyFunctionInRefGraph = true;
                showFunction.isCopyFilePath = true;
                showFunction.isExportCallGraphToSVG = true;
                let panelParams: GraphPanelParameters = {};
                panelParams.refName = fileName;
                const panel = new CallGraphPanel(
                    context,
                    GraphType.Reference,
                    undefined,
                    showFunction,
                    panelParams,
                );
                panel.showCallGraph(svg, true);
            },
        );
    };
};

export const generateAllFilesCallGraph = (
    context: vscode.ExtensionContext,
    uri2RangesMap: Map<string, vscode.Range[]>,
    ref_name_with_uri: string,
) => {
    return async () => {
        Log.info("Start to generate All Files CallGraph...");
        const match = ref_name_with_uri.match(/#(.*?)@/);
        const refName = match ? match[1] : "";

        const locations: vscode.Location[] =
            parseUri2RangesMapToLocations(uri2RangesMap);
        const { ref_functions, ref_functions_map_range } =
            await getReferFuncWithRange(locations);

        if (ref_functions.length === 0) {
            vscode.window.showInformationMessage(
                "The current file has no function or method reference to the selected attribute",
            );
            return;
        }

        // 处理函数 获取函数的call graph集合
        let ref_callGraphs_map = new Map<string, Set<string>>();
        let processedMap = new Map<string, string>();

        await processRefFunctions(
            ref_functions,
            ref_callGraphs_map,
            processedMap,
        );

        const dotResult = await generateMultipleReferDot(
            ref_callGraphs_map,
            ref_name_with_uri,
            ref_functions_map_range,
        );

        let callReferDot = dotResult.dot.toString();
        if (!callReferDot) {
            Log.info("[ERROR] Failed to generateDot.");
        } else {
            Log.info("[SUCCESS] generateDot success");
        }

        viz.then((viz) => viz.renderString(callReferDot, renderOptions)).then(
            (svg) => {
                if (!svg) {
                    vscode.window.showErrorMessage("No results");
                    Log.info("[ERROR]  Dot to Svg failed");
                    return;
                }
                let showFunction: GraphPanelFunction = {};
                showFunction.isCopyFunction = true;
                showFunction.isJump2Function = true;
                showFunction.isJumpToTheFirstReference = true;
                showFunction.isCopyFunctionInRefGraph = true;
                showFunction.isCopyFilePath = true;
                showFunction.isExportCallGraphToSVG = true;
                let panelParams: GraphPanelParameters = {};
                panelParams.refName = refName;
                const panel = new CallGraphPanel(
                    context,
                    GraphType.Reference,
                    undefined,
                    showFunction,
                    panelParams,
                );
                panel.showCallGraph(svg, true);
            },
        );
    };
};

// 遍历 references，按 URI 归类存入 uriToRangesMap，并只对第一次遇到的 URI 请求 documentSymbolProvider，过滤出函数和方法类型后存入 uriToSymbolsMap
async function buildUriToRangesMap(references: vscode.Location[]): Promise<{
    uri2RangesMap: Map<string, vscode.Range[]>;
}> {
    const uri2RangesMap = new Map<string, vscode.Range[]>();

    for (const ref of references) {
        const uriStr = ref.uri.path.toString(); // 更精确：包含 scheme 和 query（如 file://）

        if (!uri2RangesMap.has(uriStr)) {
            uri2RangesMap.set(uriStr, []);
        }
        // 从显示索引 start line 和 end line -> 更改为显示行号 start line 和 end line 都 +1
        const lineRange = new vscode.Range(
            ref.range.start.line + 1,
            ref.range.start.character,
            ref.range.end.line + 1,
            ref.range.end.character,
        );

        uri2RangesMap.get(uriStr)!.push(lineRange);
        //uri2RangesMap.get(uriStr)!.push(ref.range);
    }

    return { uri2RangesMap };
}

export function unifyDotLabelEllipsis(
    dot: string,
    expandedNodeId?: string,
): string {
    // 1. 找出所有 label 带 ... 的节点名
    const nodeLabelRegex = /"([^"]+)"\[label="([^"]+?)\.{3,}",/g;
    const ellipsisNames = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = nodeLabelRegex.exec(dot)) !== null) {
        ellipsisNames.add(match[1]);
    }

    if (ellipsisNames.size === 0) {return dot;}

    // 解析被点击节点的详细信息（如果提供了expandedNodeId）
    let expandedNodeInfo: {
        filePath: string;
        funcName: string;
        line: number;
        // character: number;
    } | null = null;

    if (expandedNodeId && expandedNodeId.includes("#")) {
        const [filePath, anchor] = expandedNodeId.split("#");
        if (anchor && anchor.includes("@")) {
            const [funcName, position] = anchor.split("@");
            const posMatch = position.match(/(\d+):(\d+)/);
            if (posMatch) {
                expandedNodeInfo = {
                    filePath: filePath,
                    funcName: funcName,
                    line: parseInt(posMatch[1], 10),
                    // character: parseInt(posMatch[2], 10)
                };
            }
        }
    }

    // 2. 替换所有同名节点的 label，加上 ... 并设置 fillcolor
    let result = dot;
    ellipsisNames.forEach((name) => {
        const labelReplaceRegex = new RegExp(
            `("${escapeRegExp(name)}"\\[label=")([^"]*?)(\\.\\.\\.)?(", )`,
            "g",
        );
        result = result.replace(
            labelReplaceRegex,
            (substring, p1, p2, p3, p4) => {
                // 检查当前节点是否是被点击展开的节点
                let isExpandedNode = false;

                if (expandedNodeInfo) {
                    // 解析当前节点的信息，支持多种格式
                    let cleanName = name;

                    // 移除可能的提示文本
                    if (name.includes("\n")) {
                        const lines = name.split("\n");
                        // 找到包含文件路径的行（通常是最后一行或包含#@的行）
                        cleanName =
                            lines.find(
                                (line) =>
                                    line.includes("#") && line.includes("@"),
                            ) || lines[lines.length - 1];
                    }

                    // 更精确的正则匹配，处理各种可能的路径格式
                    const nodeInfoMatch = cleanName.match(
                        /([^#]+)#([^@]+)@(\d+):(\d+)$/,
                    );
                    if (nodeInfoMatch) {
                        const nodeFilePath = nodeInfoMatch[1].trim();
                        const nodeFuncName = nodeInfoMatch[2];
                        const nodeLine = parseInt(nodeInfoMatch[3], 10);
                        // 精确匹配：文件路径、函数名、行号和列号都要匹配
                        // 这样可以区分同一文件中同名但位置不同的函数
                        isExpandedNode =
                            nodeFilePath === expandedNodeInfo.filePath &&
                            nodeFuncName === expandedNodeInfo.funcName &&
                            nodeLine === expandedNodeInfo.line;
                    }
                }
                return `${p1}${p2}...${p4}`;
            },
        );
    });
    return result;
}

// 工具函数：正则转义
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 给 SVG 中所有 label 带 ... 的节点添加圆圈和加号   备份
 * @param svg SVG 字符串
 * @param nodeFlags 节点标志映射，key: 节点名，value: 标志值(1=十字+圆圈，0=减号+圆圈)
 */
export function addCirclePlusToEllipsisNodes(
    svg: string,
    nodeFlags: Map<string, number> = new Map(),
): string {
    return svg.replace(
        /<g[^>]*class="node"[^>]*>([\s\S]*?)<\/g>/g,
        (match, content) => {
            // 只给 label 带 ... 的节点加圆圈
            const textMatch = content.match(/<text[^>]*>([^<]+)<\/text>/);
            if (!textMatch || !textMatch[1].includes("...")) {
                return match; // 不加圆圈
            }

            // 提取 <path> 的 d 属性
            const pathMatch = content.match(/<path[^>]* d="([^"]+)"/);
            let circleCx = 0,
                circleCy = 0;
            if (pathMatch) {
                const d = pathMatch[1];
                const coords = [...d.matchAll(/([-\d.]+),([-\d.]+)/g)].map(
                    (m) => [parseFloat(m[1]), parseFloat(m[2])],
                );
                const maxX = Math.max(...coords.map((c) => c[0]));
                const ys = coords.filter((c) => c[0] === maxX).map((c) => c[1]);
                const avgY =
                    ys.length > 0
                        ? ys.reduce((a, b) => a + b, 0) / ys.length
                        : 0;
                circleCx = maxX;
                circleCy = avgY;
            } else {
                const textCoordMatch = content.match(
                    /<text[^>]* x="([\d.-]+)" y="([\d.-]+)"/,
                );
                if (textCoordMatch) {
                    circleCx = parseFloat(textCoordMatch[1]);
                    circleCy = parseFloat(textCoordMatch[2]);
                } else {
                    circleCx = 100;
                    circleCy = 100;
                }
            }

            const r = 5;
            const titleMatch = content.match(/<title>([^<]+)<\/title>/);
            let nodeName = "";
            if (titleMatch) {
                const lines = titleMatch[1].split("\n");
                // 处理包含提示文本的情况
                if (lines.length > 1) {
                    // 第一行是提示文本，第二行是真正的节点标识符
                    const firstLine = lines[0].trim();
                    if (firstLine.startsWith("Tips:")) {
                        nodeName = lines[1].trim();
                    } else {
                        nodeName = firstLine;
                    }
                } else {
                    nodeName = lines[0].trim();
                }
            } else {
                nodeName = textMatch[1].replace(/\.{3,}$/, "");
            }

            // HTML解码节点名
            nodeName = nodeName
                .replace(/&#45;/g, "-") // 解码连字符
                .replace(/&amp;/g, "&") // 解码&符号
                .replace(/&lt;/g, "<") // 解码<符号
                .replace(/&gt;/g, ">") // 解码>符号
                .replace(/&quot;/g, '"'); // 解码引号

            // 根据标志确定圆圈样式和类名
            const nodeFlag = nodeFlags.get(nodeName) ?? 1; // 默认为1（十字符号）
            const isExpanded = nodeFlag === 0;

            const circleClass = isExpanded ? "minus-circle" : "plus-circle";
            const circleColor = isExpanded ? "#f8f9fa" : "#f8f9fa";
            const title = isExpanded ? "click to collapse" : "click to expand";

            // 根据标志生成不同的符号
            let symbolLines = "";
            if (isExpanded) {
                // 减号（只有横线）
                symbolLines = `<line x1="${circleCx - 4.5}" y1="${circleCy}" x2="${circleCx + 4.5}" y2="${circleCy}" stroke="#000000" stroke-width="1"/>`;
            } else {
                // 十字（竖线 + 横线）
                symbolLines = `
                <line x1="${circleCx}" y1="${circleCy - 4.5}" x2="${circleCx}" y2="${circleCy + 4.5}" stroke="#000000" stroke-width="1"/>
                <line x1="${circleCx - 4.5}" y1="${circleCy}" x2="${circleCx + 4.5}" y2="${circleCy}" stroke="#000000" stroke-width="1"/>`;
            }

            // 删除节点文本中的省略号
            const updatedContent = content.replace(
                /<text([^>]*)>([^<]+)<\/text>/,
                (textElement: string, attrs: string, text: string) => {
                    const textWithoutEllipsis = text.replace(/\.{3,}$/, "");
                    return `<text${attrs}>${textWithoutEllipsis}</text>`;
                },
            );

            // 用 <g> 包裹 circle 和 line，整个分组都可点击，默认隐藏
            const nodeWithoutEllipsis = match.replace(content, updatedContent);

            return `${nodeWithoutEllipsis}
            <g class="${circleClass}" style="cursor:pointer;opacity:0;transition:opacity 0.3s ease;" data-node="${nodeName.replace(/"/g, "&quot;")}" data-flag="${nodeFlag}">
                <title>${title}</title>
                <circle cx="${circleCx}" cy="${circleCy}" r="${r}" fill="${circleColor}" stroke="#000000" stroke-width="1"/>
                ${symbolLines}
            </g>
        `;
        },
    );
}
