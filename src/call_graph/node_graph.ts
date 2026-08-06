import { CallHierarchyItem } from "vscode";
import * as vscode from "vscode";
import { CALL_GRAPH_MAX_DEPTH, CALL_GRAPH_MAX_NODES } from "../config";
import { CALL_GRAPH_Function_Truncation } from "../config";
import { Log } from "../util/logger";

export interface CallHierarchyNode {
    item: CallHierarchyItem;
    father: CallHierarchyNode[];
    children: CallHierarchyNode[];
    parameters?: string; // 新增：函数参数字符串
    hasMore?: boolean; // 新增，标记是否还有未展开的子节点， 控制dot字符传中<text>标签的内容是否含有...,
    // 进而控制在svg字符串中是否需要画展开或折叠圆圈

    currNodeDepth?: number;
}
let isFirstGraphGeneration = true;

export function getFirstGraphGenerationFlg(): boolean {
    return isFirstGraphGeneration;
}

export function setFirstGraphGenerationFlg(flag: boolean): void {
    isFirstGraphGeneration = flag;
}

let maxIncomingGraphRealDepth = 0;
export function getMaxIncomingGraphRealDepth(): number {
    return maxIncomingGraphRealDepth;
}

export function setMaxIncomingGraphRealDepth(depth: number) {
    return (maxIncomingGraphRealDepth = depth);
}

// 获取用户配置的函数名和类名黑名单
function getCallGraphBlacklists() {
    const config = vscode.workspace.getConfiguration("Synapse");
    const funcListRaw: string[] = config.get("callGraphFunctionBlacklist", []);
    const classListRaw: string[] = config.get("callGraphClassBlacklist", []);
    const pathListRaw: string[] = config.get("callGraphPathBlacklist", []);
    // 支持分号分隔多个名字
    const funcList: string[] = funcListRaw.flatMap((item) =>
        item
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean),
    );
    const classList: string[] = classListRaw.flatMap((item) =>
        item
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean),
    );
    const pathList: string[] = pathListRaw.flatMap((item) =>
        item
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean),
    );
    return {
        funcBlacklist: new Set(funcList),
        classBlacklist: new Set(classList),
        pathBlacklist: pathList,
    };
}

// 因为我们clanged给的就是调用关系 当前函数有点类似深度遍历把
async function insertIncomingCallHierarchyNode(
    graph_node: CallHierarchyNode,
    graph_node_set: Set<CallHierarchyNode>,
    command: string,
    maxDepth: number,
    depth = 0,
): Promise<void> {
    // 更新真实最大深度（depth 从 0 开始，根为第 1 层）
    graph_node.currNodeDepth = Math.max(graph_node.currNodeDepth || 0, depth);

    // 深度限制
    if (depth >= maxDepth) {
        graph_node.hasMore = true;
        return;
    }

    // 新增：节点数量超过个数限制直接停止
    if (graph_node_set.size > CALL_GRAPH_MAX_NODES) {return;}
    graph_node_set.add(graph_node);

    //incoming
    // 过滤
    const { funcBlacklist, classBlacklist, pathBlacklist } =
        getCallGraphBlacklists();
    function shouldFilterCall(call_to: vscode.CallHierarchyItem): boolean {
        const detail = call_to.detail || "";
        const parts = detail.split("::");
        const len = parts.length;
        const funcName = parts[len - 1] || call_to.name;
        const className = len > 1 ? parts[len - 2] : "";
        const fullName = len > 1 ? parts.slice(len - 2).join("::") : funcName;
        const filePath = call_to.uri?.path || "";
        for (const pathPrefix of pathBlacklist) {
            if (filePath.startsWith(pathPrefix)) {return true;}
        }
        if (funcBlacklist.has(fullName)) {return true;}
        if (funcBlacklist.has(funcName)) {return true;}
        if (classBlacklist.has(className)) {return true;}
        return false;
    }

    // 过滤
    const incoming_calls: vscode.CallHierarchyIncomingCall[] =
        (await vscode.commands.executeCommand(command, graph_node.item)) || [];

    await Promise.all(
        incoming_calls.map(async (incoming_call) => {
            const call_from = incoming_call.from;
            if (!call_from || call_from.kind === vscode.SymbolKind.Operator) {
                return; // skip Operator
            }

            if (!call_from || shouldFilterCall(call_from)) {
                return; // skip invalid call or filtered by blacklist
            }

            let isSkip = false;

            // 如果 graph_node_set 中已存在相同 item，则建立连接并跳过递归
            for (const node of graph_node_set) {
                if (isCallHierarchyItemEqual(node.item, call_from)) {
                    graph_node.father.push(node);
                    node.children.push(graph_node);
                    isSkip = true;
                }
            }

            if (isSkip) {return;}
            const father: CallHierarchyNode = {
                item: call_from,
                father: [],
                children: [],
            };
            graph_node.father.push(father);
            father.children.push(graph_node);

            await insertIncomingCallHierarchyNode(
                father,
                graph_node_set,
                command,
                maxDepth,
                depth + 1,
            );
        }),
    );
}

async function insertCallHierarchyOutgoingNodeTree(
    graph_node: CallHierarchyNode,
    graph_node_set: Set<CallHierarchyNode>,
    command: string,
    maxDepth: number,
    depth = 0,
    isTree: boolean,
): Promise<void> {
    if (maxDepth > 0 && depth >= maxDepth) {return;}
    graph_node_set.add(graph_node);
    const outgoing_calls: vscode.CallHierarchyOutgoingCall[] =
        await vscode.commands.executeCommand(command, graph_node.item);
    //去除重复的行列号
    function deduplicateFromRanges(fromRanges: any[]): any[] {
        const rangeKeyMap = new Map<string, any>(); // key:行列拼接唯一值, value:原始fromRange
        return fromRanges.filter((fr) => {
            // 提取fromRange的行列信息（兼容现有数据格式：c=start, e=end）
            const startCol = fr.c?.c ?? 0; // 起始列
            const startLine = fr.c?.e ?? 0; // 起始行
            const endCol = fr.e?.c ?? 0; // 结束列
            const endLine = fr.e?.e ?? 0; // 结束行
            // 生成唯一key（确保相同位置的range对应同一个key）
            const uniqueKey = `${startLine}-${startCol}-${endLine}-${endCol}`;
            // 仅保留第一次出现的range
            if (!rangeKeyMap.has(uniqueKey)) {
                rangeKeyMap.set(uniqueKey, fr);
                return true;
            }
            return false;
        });
    }
    // 获取黑名单，过滤
    const { funcBlacklist, classBlacklist, pathBlacklist } =
        getCallGraphBlacklists();
    function shouldFilterCall(call_to: vscode.CallHierarchyItem): boolean {
        const detail = call_to.detail || "";
        const parts = detail.split("::");
        const len = parts.length;
        const funcName = parts[len - 1] || call_to.name;
        const className = len > 1 ? parts[len - 2] : "";
        const fullName = len > 1 ? parts.slice(len - 2).join("::") : funcName;
        // 路径过滤：只要路径前缀匹配就过滤
        const filePath = call_to.uri?.path || "";
        for (const pathPrefix of pathBlacklist) {
            // 只过滤指定目录及其子目录，避免误过滤前缀相似但不是子目录的路径
            if (
                filePath === pathPrefix ||
                filePath.startsWith(pathPrefix + "/")
            )
                {return true;}
        }
        // 1. 完整类名+函数名（SlotHandler::scheduleBySlotTypeMode）
        if (funcBlacklist.has(fullName)) {return true;}
        // 2. 仅函数名
        if (funcBlacklist.has(funcName)) {return true;}
        // 3. 仅类名
        if (classBlacklist.has(className)) {return true;}
        return false;
    }
    // 判断是否需要截断递归
    function shouldTruncateClass(call_to: vscode.CallHierarchyItem): boolean {
        const detail = call_to.detail || "";
        const parts = detail.split("::");
        const len = parts.length;
        const className = len > 1 ? parts[len - 2] : "";
        return CALL_GRAPH_Function_Truncation.includes(className);
    }
    // 处理子节点
    const addAndMaybeRecurse = async (
        call_to: vscode.CallHierarchyItem,
        fromRanges: any[] = [],
    ) => {
        if (!call_to || shouldFilterCall(call_to)) {return;}
        const childNode: CallHierarchyNode & { fromRanges?: any } = {
            item: call_to,
            father: [],
            children: [],
            fromRanges: fromRanges,
        };
        graph_node.children.push(childNode);
        if (shouldTruncateClass(call_to)) {return;}

        // 在树模式下，每个节点都需要递归处理其子节点，即使函数相同
        // 在非树模式下，保持原有逻辑避免重复出现节点
        const shouldRecurse =
            isTree ||
            ![...graph_node_set].some((n) =>
                isCallHierarchyItemEqual(n.item, call_to),
            );
        if (shouldRecurse) {
            await insertCallHierarchyOutgoingNodeTree(
                childNode,
                graph_node_set,
                command,
                maxDepth,
                depth + 1,
                isTree,
            );
        }
    };
    //判断是否为树，树的话节点信息多加fromRanges，并且多次调用的节点拆分成多个节点
    if (isTree) {
        await Promise.all(
            outgoing_calls.map(async (incoming_call) => {
                let call_to = incoming_call.to;
                if (
                    !Array.isArray(incoming_call.fromRanges) ||
                    incoming_call.fromRanges.length === 0
                ) {
                    await addAndMaybeRecurse(call_to, []);
                } else {
                    const uniqueFromRanges = deduplicateFromRanges(
                        incoming_call.fromRanges,
                    );
                    await Promise.all(
                        uniqueFromRanges.map(async (fr) => {
                            await addAndMaybeRecurse(call_to, [fr]);
                        }),
                    );
                }
            }),
        );
    } else {
        await Promise.all(
            outgoing_calls.map(async (incoming_call) => {
                let call_to = incoming_call.to;
                if (!call_to || shouldFilterCall(call_to)) {return;}
                let isSkip = false;
                for (const node of graph_node_set) {
                    if (isCallHierarchyItemEqual(node.item, call_to)) {
                        graph_node.children.push(node);
                        isSkip = true;
                    }
                }
                if (isSkip) {return;}
                const children: CallHierarchyNode = {
                    item: call_to,
                    father: [],
                    children: [],
                };
                graph_node.children.push(children);
                if (shouldTruncateClass(call_to)) {return;}
                await insertCallHierarchyOutgoingNodeTree(
                    children,
                    graph_node_set,
                    command,
                    maxDepth,
                    depth + 1,
                    isTree,
                );
            }),
        );
    }
}

async function insertCallHierarchyOutgoingNode(
    graph_node: CallHierarchyNode,
    graph_node_set: Set<CallHierarchyNode>,
    command: string,
    maxDepth: number,
    depth = 0,
): Promise<void> {
    if (maxDepth > 0 && depth >= maxDepth) {return;}
    graph_node_set.add(graph_node);
    const outgoing_calls: vscode.CallHierarchyOutgoingCall[] =
        await vscode.commands.executeCommand(command, graph_node.item);
    Log.debug("generate outgoing outgoing_calls");
    // 获取黑名单，过滤
    const { funcBlacklist, classBlacklist, pathBlacklist } =
        getCallGraphBlacklists();
    function shouldFilterCall(call_to: vscode.CallHierarchyItem): boolean {
        const detail = call_to.detail || "";
        const parts = detail.split("::");
        const len = parts.length;
        const funcName = parts[len - 1] || call_to.name;
        const className = len > 1 ? parts[len - 2] : "";
        const fullName = len > 1 ? parts.slice(len - 2).join("::") : funcName;
        const filePath = call_to.uri?.path || "";
        for (const pathPrefix of pathBlacklist) {
            if (filePath.startsWith(pathPrefix)) {return true;}
        }
        if (funcBlacklist.has(fullName)) {return true;}
        if (funcBlacklist.has(funcName)) {return true;}
        if (classBlacklist.has(className)) {return true;}
        return false;
    }
    await Promise.all(
        outgoing_calls.map(async (incoming_call) => {
            const call_to = incoming_call.to;
            Log.debug("generate outgoing call_to_name:" + call_to.name); //后续节点的名字

            if (!call_to || call_to.kind === vscode.SymbolKind.Operator) {
                return; // skip Operator
            }

            if (!call_to || shouldFilterCall(call_to)) {
                return; // skip invalid call or filtered by blacklist
            }
            let isSkip = false;
            for (const node of graph_node_set) {
                if (isCallHierarchyItemEqual(node.item, call_to)) {
                    graph_node.children.push(node);
                    // node.father.push(graph_node);
                    isSkip = true;
                }
            }
            if (isSkip) {return;}

            const children: CallHierarchyNode = {
                item: call_to,
                father: [],
                children: [],
            };
            // 判断第三层是否还有数据
            if (depth + 1 < maxDepth) {
                // 递归构建第二层
                await insertCallHierarchyOutgoingNode(
                    children,
                    graph_node_set,
                    command,
                    maxDepth,
                    depth + 1,
                );
                graph_node.children.push(children);
            } else if (depth + 1 === maxDepth) {
                const thirdCalls = await vscode.commands.executeCommand<
                    vscode.CallHierarchyOutgoingCall[]
                >(command, call_to);
                // 过滤黑名单
                const validThirdCalls = thirdCalls
                    ? thirdCalls.filter((c) => c.to && !shouldFilterCall(c.to))
                    : [];
                if (validThirdCalls.length > 0) {
                    children.hasMore = true; // 标记有后续节点
                    // Log.info("存在后续节点!!!!");
                }
                graph_node.children.push(children); // 只插入第二层节点，不递归插入第三层
            }
        }),
    );
}
export async function getFuncCallNodeGraph(
    entryItem: vscode.CallHierarchyItem,
    isOutgoing: boolean = false,
    isOutgoingTree: boolean = false,
    maxDepth?: number,
    outgoingDepth: number = 0, // 动态传入
): Promise<CallHierarchyNode> {
    const realMaxDepth =
        typeof maxDepth === "number" ? maxDepth : CALL_GRAPH_MAX_DEPTH;

    let command = "vscode.provideIncomingCalls";
    if (isOutgoing) {
        command = "vscode.provideOutgoingCalls";
    }
    if (getFirstGraphGenerationFlg()) {
        {
            // 执行预热命令
            await vscode.commands.executeCommand(command, entryItem);
            //等待一段时间
            await new Promise((resolve) => setTimeout(resolve, 5000));
            Log.info("Call Graph First Generation Warm-up Completed.");
            setFirstGraphGenerationFlg(false);
        }
    }
    const graph_node_set = new Set<CallHierarchyNode>();
    const graph_node: CallHierarchyNode = {
        item: entryItem,
        father: [],
        children: [],
        hasMore: false,
    };

    // 如果是 Incoming 调用图，则初始化或使用外部提供的真实深度引用
    if (!isOutgoing) {
        await insertIncomingCallHierarchyNode(
            graph_node,
            graph_node_set,
            command,
            realMaxDepth,
            0,
        );
        // 仅当处理 Incoming 调用图时设置真实深度
        for (const node of graph_node_set) {
            if (typeof node.currNodeDepth === "number") {
                setMaxIncomingGraphRealDepth(
                    Math.max(maxIncomingGraphRealDepth, node.currNodeDepth),
                );
            }
        }
    } else if (isOutgoingTree) {
        await insertCallHierarchyOutgoingNodeTree(
            graph_node,
            graph_node_set,
            command,
            realMaxDepth,
            0,
            isOutgoingTree,
        );
    } else {
        await insertCallHierarchyOutgoingNode(
            graph_node,
            graph_node_set,
            command,
            outgoingDepth,
        );
    }

    return graph_node;
}

// 插入新的出边节点
export function insertOutgoingNodeToGraph(
    root: CallHierarchyNode,
    newNode: CallHierarchyNode,
) {
    function getSimpleName(name: string) {
        // 先去掉::前缀，再去掉泛型参数
        let simple = name.includes("::") ? name.split("::").pop()! : name;
        // 去掉泛型参数
        simple = simple.replace(/<.*?>/, "");
        return simple.trim();
    }

    function findNodeByItem(
        node: CallHierarchyNode,
        targetItem: CallHierarchyItem,
    ): CallHierarchyNode | null {
        if (
            getSimpleName(node.item.name) === getSimpleName(targetItem.name) &&
            node.item.uri?.toString() === targetItem.uri?.toString() &&
            Math.abs(
                node.item.range.start.line - targetItem.range.start.line,
            ) <= 4
            // node.item.range.start.character === targetItem.range.start.character
        ) {
            return node;
        }
        for (const child of node.children) {
            const found = findNodeByItem(child, targetItem);
            if (found) {return found;}
        }
        return null;
    }

    // 找到 root 里的对应节点
    const matchedNode = findNodeByItem(root, newNode.item);
    if (!matchedNode) {
        // Log.info(`[插入失败] 未找到目标节点: ${newNode.item.name}`);
        return false;
    }

    let insertCount = 0;
    // 插入时也用 getSimpleName 比较
    for (const child of newNode.children) {
        const exists = matchedNode.children.some(
            (c) =>
                getSimpleName(c.item.name) === getSimpleName(child.item.name) &&
                c.item.uri?.toString() === child.item.uri?.toString() &&
                Math.abs(
                    c.item.range.start.line - child.item.range.start.line,
                ) <= 4,
        );
        if (!exists) {
            matchedNode.children.push(child);
            insertCount++;
        }
    }

    if (insertCount > 0) {
        // Log.info(`[插入成功] 节点 ${matchedNode.item.name} 插入了 ${insertCount} 个新子节点`);
        return true;
    } else {
        // Log.info(`[插入失败] 节点 ${matchedNode.item.name} 没有新子节点可插入`);
        return false;
    }
}

// 移除指定节点的所有子节点
export function removeChildrenFromNode(
    root: CallHierarchyNode,
    nodeIdentifier: string,
    nodeFlags?: Map<string, any>, // 新增参数：节点状态Map, 用于清楚节点展/收缩状态
): boolean {
    function parseNodeIdentifier(identifier: string): {
        filePath: string;
        funcName: string;
        line: number;
        character: number;
    } | null {
        if (!identifier.includes("#") || !identifier.includes("@")) {
            return null;
        }

        const [filePath, anchor] = identifier.split("#");
        const [funcName, position] = anchor.split("@");
        const posMatch = position.match(/(\d+):(\d+)/);

        if (!posMatch) {
            return null;
        }

        return {
            filePath: filePath.trim(),
            funcName: funcName.trim(),
            line: parseInt(posMatch[1], 10),
            character: parseInt(posMatch[2], 10),
        };
    }

    function getSimpleName(name: string) {
        // 先去掉::前缀，再去掉泛型参数
        let simple = name.includes("::") ? name.split("::").pop()! : name;
        // 去掉泛型参数
        simple = simple.replace(/<.*?>/, "");
        return simple.trim();
    }

    function findNodeByIdentifier(
        node: CallHierarchyNode,
        targetInfo: {
            filePath: string;
            funcName: string;
            line: number;
            character: number;
        },
    ): CallHierarchyNode | null {
        // 比较节点的标识信息
        const nodeSimpleName = getSimpleName(node.item.name);
        const nodeFilePath = node.item.uri.fsPath || node.item.uri.path;

        // 精确匹配：文件路径、函数名、行号和列号（兼容DOT行号偏移）
        if (
            nodeFilePath === targetInfo.filePath &&
            (nodeSimpleName === targetInfo.funcName ||
                nodeSimpleName ===
                    targetInfo.funcName.substring(
                        0,
                        targetInfo.funcName.lastIndexOf("<"),
                    )) &&
            node.item.range.start.line === targetInfo.line - 1
        ) {
            return node;
        }

        // 递归搜索子节点
        for (const child of node.children) {
            const found = findNodeByIdentifier(child, targetInfo);
            if (found) {return found;}
        }

        return null;
    }

    function removeNodeFlagsRecursively(node: CallHierarchyNode) {
        if (!nodeFlags) {return;}
        // 构造节点唯一标识符
        const nodeId = `${node.item.uri.fsPath || node.item.uri.path}#${getSimpleName(node.item.name)}@${node.item.range.start.line + 1}:${node.item.range.start.character}`;
        nodeFlags.delete(nodeId);
        node.children.forEach((child) => removeNodeFlagsRecursively(child));
    }

    // 解析节点标识符
    const targetInfo = parseNodeIdentifier(nodeIdentifier);
    if (!targetInfo) {
        // Log.info(`[移除失败] 无效的节点标识符: ${nodeIdentifier}`);
        return false;
    }

    // 查找目标节点
    const targetNode = findNodeByIdentifier(root, targetInfo);
    if (!targetNode) {
        // Log.info(`[移除失败] 未找到目标节点: ${nodeIdentifier}`);
        return false;
    }

    // 递归移除所有子节点的状态
    targetNode.children.forEach((child) => removeNodeFlagsRecursively(child));

    // 记录移除前的子节点数量
    const childCount = targetNode.children.length;

    if (childCount === 0) {
        // Log.info(`[移除完成] 节点 ${targetNode.item.name} 本身就没有子节点`);
        return true;
    }

    // 移除所有子节点
    targetNode.children = [];

    // Log.info(`[移除成功] 节点 ${targetNode.item.name} 移除了 ${childCount} 个子节点`);
    return true;
}
// 移除子节点的逻辑部分

async function generateRefNode(
    children: vscode.CallHierarchyItem,
    nodeMap: Map<string, Set<string>>,
    command: string,
    maxDepth: number,
    processedMap?: Map<string, string>,
    depth = 0,
): Promise<void> {
    if (maxDepth > 0 && depth >= maxDepth) {return;}

    // 节点名生成逻辑
    let nodeName = "";
    let node_name_map_key = "";
    if (processedMap) {
        const filter_name = children.name.includes("::")
            ? children.name.split("::").pop()!
            : children.name;
        node_name_map_key = `${children.uri.path}#${filter_name}`;
        nodeName = `${children.uri.path}#${filter_name}@${children.range.start.line + 1}:${children.range.start.character}`;
        // 唯一性映射
        const value = processedMap.get(node_name_map_key);
        if (value) {
            nodeName = value;
        } else {
            processedMap.set(node_name_map_key, nodeName);
        }
    } else {
        nodeName = `${children.uri.path}#${children.name}@${children.range.start.line}:${children.range.start.character}`;
    }

    // 已处理过则跳过
    if (nodeMap.has(nodeName) && nodeMap.get(nodeName)!.size > 0) {
        return;
    }
    if (!nodeMap.has(nodeName)) {
        nodeMap.set(nodeName, new Set());
    }

    const calls: vscode.CallHierarchyIncomingCall[] =
        await vscode.commands.executeCommand(command, children);

    await Promise.all(
        calls.map(async (call) => {
            const father = call.from;
            if (!father) {return;}

            let fatherName = "";
            let node_father_name_map_key = "";
            if (processedMap) {
                const filter_father_name = father.name.includes("::")
                    ? father.name.split("::").pop()!
                    : father.name;
                node_father_name_map_key = `${father.uri.path}#${filter_father_name}`;
                fatherName = `${father.uri.path}#${filter_father_name}@${father.range.start.line + 1}:${father.range.start.character}`;
                const value = processedMap.get(node_father_name_map_key);
                if (value) {
                    fatherName = value;
                } else {
                    processedMap.set(node_father_name_map_key, fatherName);
                }
            } else {
                fatherName = `${father.uri.path}#${father.name}@${father.range.start.line}:${father.range.start.character}`;
            }

            if (!nodeMap.has(fatherName)) {
                nodeMap.set(fatherName, new Set());
            }
            nodeMap.get(nodeName)!.add(fatherName);

            await generateRefNode(
                father,
                nodeMap,
                command,
                maxDepth,
                processedMap,
                depth + 1,
            );
        }),
    );
}

export async function getRefGraph(
    entryItem: vscode.CallHierarchyItem,
    nodeMap: Map<string, Set<string>>,
    processedMap?: Map<string, string>,
): Promise<{
    nodeMap: Map<string, Set<string>>;
    processedMap?: Map<string, string>;
}> {
    const maxDepth = CALL_GRAPH_MAX_DEPTH;
    const command = "vscode.provideIncomingCalls";
    await generateRefNode(entryItem, nodeMap, command, maxDepth, processedMap);
    return { nodeMap, processedMap };
}

function isCallHierarchyItemEqual(a: CallHierarchyItem, b: CallHierarchyItem) {
    return (
        a.name === b.name &&
        a.kind === b.kind &&
        a.uri.toString() === b.uri.toString() &&
        a.range.start.line === b.range.start.line &&
        a.range.start.character === b.range.start.character
    );
}

export async function generateMultipleIncomingTree(
    node: vscode.CallHierarchyItem,
    nodeMap: Map<string, Set<string>>,
    maxDepth: 100,
    depth = 0,
): Promise<void> {
    if (maxDepth > 0 && depth >= maxDepth) {
        return;
    }
    let nodeName = "";
    nodeName = `${node.uri.path}#${node.name}@${node.range.start.line}:${node.range.start.character}`;
    if (nodeMap.has(nodeName) && nodeMap.get(nodeName)!.size > 0) {
        return;
    }
    // 初始化节点
    if (!nodeMap.has(nodeName)) {
        nodeMap.set(nodeName, new Set());
    }
    const calls: vscode.CallHierarchyIncomingCall[] =
        await vscode.commands.executeCommand(
            "vscode.provideIncomingCalls",
            node,
        );
    await Promise.all(
        calls.map(async (call) => {
            const father = call.from;
            if (!father) {
                return;
            }
            const fatherName = `${father.uri.path}#${father.name}@${father.range.start.line}:${father.range.start.character}`;
            // 初始化子节点集合
            if (!nodeMap.has(fatherName)) {
                nodeMap.set(fatherName, new Set());
            }
            // 将父亲添加到当前节点的 set 中
            nodeMap.get(nodeName)!.add(fatherName);
            // 递归处理子节点
            await generateMultipleIncomingTree(
                father,
                nodeMap,
                maxDepth,
                depth + 1,
            );
        }),
    );
}
