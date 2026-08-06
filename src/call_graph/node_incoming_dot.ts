import { CallHierarchyNode } from "./node_graph";
import * as fs from "fs";
import * as vscode from "vscode";
import { isDeepStrictEqual } from "util";
import { output } from "./generator";
import { Log } from "../util/logger";


function getDotNode(n: CallHierarchyNode, root: string): Node {
    // const tipStr = "Tips: Ctrl+Left Click to jump to the function\n";
    //const tipStr = "tips: CtrlLeft Click to jump to the function";
    return {
        //name: `"${n.item.uri.path}#${n.item.name}@${n.item.range.start.line + 1}:${n.item.range.start.character}"`,
        name: `"${n.item.uri.path}#${n.item.name}@${n.item.selectionRange.start.line + 1}:${n.item.selectionRange.start.character}"`,
        //对应结构[label="init", ]
        attr: { label: n.item.name },
        subgraph: {
            name: n.item.uri.path,
            attr: {
                //如果包含uplane/，则只取uplane/后面的路径 不包含就全部展示 路径扩展之后代码需要修改
                label: n.item.uri.path.includes("uplane/")
                    ? n.item.uri.path.split("uplane/")[1]
                    : n.item.uri.path.replace(root, ""),
            },
        },
        //对应
        father: [],
    };
}
function insertDotNodes(
    dot_node: Node,
    source: CallHierarchyNode,
    node_root_path: string,
    dot_node_set: Set<Node>,
) {
    dot_node_set.add(dot_node);
    for (const father of source.father) {
        const fatherNode = getDotNode(father, node_root_path);
        let isSkip = false;

        for (const existing of dot_node_set) {
            if (isNodeEqual(existing, fatherNode)) {
                dot_node.father.push(existing);
                isSkip = true;
                break;
            }
        }

        if (isSkip) {
            continue;
        }
        dot_node.father.push(fatherNode);
        insertDotNodes(fatherNode, father, node_root_path, dot_node_set);
    }
}

function insertOutgoingDotNodes(
    dot_node: Node,
    source: CallHierarchyNode,
    node_root_path: string,
    dot_node_set: Set<Node>,
    depth = 0,
    maxDepth = 0,
) {
    dot_node_set.add(dot_node);
    for (const child of source.children) {
        const childNode = getDotNode(child, node_root_path);
        Log.info(
            "depth:" +
                (depth + 1) +
                " child:" +
                child.item?.name +
                " childNode:" +
                childNode.name +
                "child.children:" +
                child.children +
                "child.children.length:" +
                child.children.length,
        );
        // 只对深度为maxDepth的节点 label 统一为 "xxx..."
        if (child.hasMore) {
            //&& 只对设置层数的节点仍有子函数才加...
            const ellipsisLabel = (child.item?.name || "") + "...";
            // 全局同步所有等价节点的 label，无论当前 label 是什么
            for (const node of dot_node_set) {
                if (node.name === childNode.name) {
                    node.attr = node.attr || {};
                    node.attr.label = ellipsisLabel;
                }
            }
            // 新节点也要统一
            childNode.attr = childNode.attr || {};
            childNode.attr.label = ellipsisLabel;
        }

        let isSkip = false;
        let existingNode: Node | undefined = undefined;
        for (const existing of dot_node_set) {
            if (isNodeEqual(existing, childNode)) {
                dot_node.father.push(existing);
                isSkip = true;
                existingNode = existing;
                break;
            }
        }

        if (isSkip) {
            continue;
        }

        dot_node.father.push(childNode);
        if (depth + 1 < maxDepth) {
            insertOutgoingDotNodes(
                childNode,
                child,
                node_root_path,
                dot_node_set,
                depth + 1,
                maxDepth,
            );
        }
    }
}

export function generateDot(graph: CallHierarchyNode) {
    Log.info("Begin to generate Dot...");
    const dotGraph = new Graph();
    const node_root_path =
        vscode.workspace.workspaceFolders?.[0].uri.path ?? "";
    const dot_node = getDotNode(graph, node_root_path);

    dot_node.attr = {
        ...dot_node.attr,
        fillcolor: "#e4ffb5", // 你可以换成你喜欢的颜色
        color: "#0d6efd",
        style: "rounded,filled,bold",
    };
    const dot_set = new Set<Node>();
    insertDotNodes(dot_node, graph, node_root_path, dot_set);

    //将dot_node的信息添加到dotGraph中
    dotGraph.addNode(dot_node);
    return dotGraph;
}

/**
 * 为 outgoing call graph 生成 dot 图
 * @param graph 根节点（CallHierarchyNode）
 */
export function generateOutgoingDot(graph: CallHierarchyNode, maxDepth = 0) {
    Log.info("Begin to generate Outgoing Dot...");
    const dotGraph = new Graph(undefined, true); // 传 true 反转箭头
    const node_root_path =
        vscode.workspace.workspaceFolders?.[0].uri.path ?? "";
    const dot_node = getDotNode(graph, node_root_path);

    // 给根节点上色
    dot_node.attr = {
        ...dot_node.attr,
        fillcolor: "#e4ffb5", // 你可以换成你喜欢的颜色
        color: "#0d6efd",
        style: "rounded,filled,bold",
    };
    const dot_set = new Set<Node>();
    insertOutgoingDotNodes(
        dot_node,
        graph,
        node_root_path,
        dot_set,
        0,
        maxDepth,
    );

    dotGraph.addNode(dot_node);
    return dotGraph;
}

// ...existing code...
function isNodeEqual(a: Node, b: Node) {
    return (
        a.name === b.name &&
        isDeepStrictEqual(a.attr, b.attr) &&
        isDeepStrictEqual(a.subgraph, b.subgraph)
    );
}

type Attr = Record<string, string> & {
    title?: string;
    label?: string;
    shape?: string;
    style?: string;
    color?: string;
};

interface Node {
    name: string;
    attr?: Attr;
    subgraph?: Subgraph;
    father: Node[];
}

interface ReferNode {
    name: string;
    label?: string;
    subgraph?: Subgraph;
}
interface Subgraph {
    name: string;
    attr?: Attr & { node?: Attr };
    cluster?: boolean;
}
class Graph {
    private _dot = "";
    private _subgraphs = new Map<string, string>();
    private _nodes = new Set<Node>();
    private _reverseEdge = false;
    private _edges = new Set<string>(); // 新增：用于去重边
    private _centerNode: string | undefined;
    constructor(title?: string, reverseEdge = false) {
        //outgoingcallgraph时reverseEdge设置为true
        this._reverseEdge = reverseEdge;
        this._dot =
            `digraph ${title ?? ""} {\n` +
            "  graph [\n" +
            "    rankdir = LR\n" +
            '    bgcolor = "#f8f9fa"\n' +
            "  ]\n" +
            "  node [\n" +
            "    shape = box\n" +
            '    style = "rounded,filled"\n' +
            '    fillcolor = "#e9f2fb"\n' +
            '    color = "#0d6efd"\n' +
            '    fontname = "Arial"\n' + // 使用Arial字体
            '    fontcolor = "#212529"\n' +
            "  ]\n" +
            "  edge [\n" +
            '    color = "#00bcd4"\n' + // 保持边的颜色为#6c757d
            "    penwidth = 1.2\n" + // 边宽度设为2.0
            "    arrowsize = 0.8\n" +
            '    fontname = "Arial"\n' + // 使用Arial字体
            "  ]\n";
    }

    addAttr(attr: Attr) {
        this._dot += this.getAttr(attr, true);
    }

    addNode(...nodes: Node[]) {
        nodes.forEach((node) => {
            this._nodes.add(node);
            const child = node.name + this.getAttr(node.attr);
            if (node.subgraph) {
                this.insertToSubgraph(node.subgraph, node.name + " ");
            }
            let s = "";
            const removeRepeat = [] as number[];
            if (node.father.length > 0) {
                const fathers = node.father
                    .map((father, index) => {
                        for (const s of this._nodes) {
                            if (isDeepStrictEqual(s, father)) {
                                removeRepeat.push(index);
                            }
                        }
                        if (father.subgraph) {
                            this.insertToSubgraph(
                                father.subgraph,
                                father.name + " ",
                            );
                        }
                        let edgeStyle = "";
                        if (
                            father.subgraph &&
                            node.subgraph &&
                            father.subgraph.name === node.subgraph.name
                        ) {
                            edgeStyle = `[
                style = "dashed"
                color = "#dc3545"
                arrowhead = "vee"
              ]`;
                        }
                        // ==== 新增：边去重 ====
                        const edgeKey = `${father.name}->${child}`;
                        if (this._edges.has(edgeKey)) {
                            return ""; // 已有则不再输出
                        }
                        this._edges.add(edgeKey);
                        // ==== 新增结束 ====
                        if (this._reverseEdge) {
                            s += `{${child}} -> {${father.name + this.getAttr(father.attr)}} ${edgeStyle}\n`;
                        } else {
                            s += `{${
                                father.name + this.getAttr(father.attr)
                            }} -> {${child}} ${edgeStyle}\n`;
                        }
                        return father.name + this.getAttr(father.attr);
                    })
                    .join(" ");
            } else {
                s += child + "\n";
            }
            this._dot += s;
            this.addNode(
                ...node.father.filter(
                    (_, index) => !removeRepeat.includes(index),
                ),
            );
        });
    }

    private insertToSubgraph(subgraph: Subgraph, node_name: string) {
        const name = subgraph.name;
        if (!this._subgraphs.has(name)) {
            this._subgraphs.set(
                name,
                `subgraph "${
                    ((subgraph.cluster ?? true) ? "cluster_" : "") + name
                }" {\n` +
                    `  style="rounded,dashed"\n` +
                    `  labelloc="t"\n` +
                    this.getAttr(subgraph.attr, true).replace(/^/gm, "  "), // 添加统一缩进
            );
        }

        this._subgraphs.set(name, this._subgraphs.get(name) + node_name);
    }

    private getAttr(attr?: Attr, isSelf = false) {
        if (!attr) {
            return "";
        }
        let s = isSelf ? "" : "[";
        Object.keys(attr).forEach((k) => {
            s += `${k}="${attr[k]}"` + (isSelf ? "\n" : ", ");
        });
        if (!isSelf) {
            s += "]";
        }
        return s;
    }

    toString() {
        let sub = "";
        this._subgraphs.forEach((v) => {
            sub += v + "\n" + "}\n";
        });
        return this._dot + sub + "}\n";
    }
}
