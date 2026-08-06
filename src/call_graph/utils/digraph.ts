// 节点的扩展属性结构
export interface NodeExtAttrs {
    in_degree?: number; // 节点的入度，用于Graph的修剪
    out_degree?: number; // 节点的出度，用于Graph的修剪
    grade?: number; // 节点等级，0=默认色，1=灰色，2=蓝色（有代码修改）
    isTrimable?: boolean; // 是否可裁剪，默认为false（不可裁剪）
}

// 节点的基本结构及属性
export interface Node {
    name: string; // 节点唯一标识
    label: string; // 显示标签
    fatherNodes: Node[]; // 父节点数组（调用此节点的节点）
    attrs: string;
    // 基础属性字符串，如 color="#fff" fontsize=10(基础属性通过字符串放在attrs中，
    // 比如style，color，fontsize，penwidth等，为所有的Graph通用的属性)
    extAttrs: NodeExtAttrs; // 节点的扩展属性，Graph特殊处理使用，动态生成，用于后续扩展
}

// Subgraph的扩展属性结构
export interface SubgraphExtAttrs {
    isVisible?: boolean; // 控制Subgraph是否显示
    // 其他根据需要增加
}

// 子图结构
export interface Subgraph {
    name: string; // 子图唯一标识
    label: string; // 显示标签
    attrs: string; // Subgraph基础属性
    extAttrs?: SubgraphExtAttrs; // Subgraph扩展属性
    nodeNames?: string[]; // 包含的节点名称列表
    childSubgraphs?: Subgraph[]; // 子子图
}

// 边结构
export interface Edge {
    from: string; // 起始节点名称
    to: string; // 目标节点名称
    attrs?: string; // 边的属性，如 style="dashed"
}

/**
 * Digraph 类 - DOT 有向图的抽象表示
 */
export class Digraph {
    private _name: string = "";
    //Digraph的名字
    private _graph_style: string = 'rankdir="LR" fontname="Arial" fontsize=10';
    //Graph通用样式，这里可以给初始默认值
    private _node_style: string =
        'shape=box style="rounded,filled" fillcolor="#f0faf5" color="#4e79a7" fontsize=10';
    //node通用样式，这里可以给初始默认值
    private _edge_style: string = 'color="#00bcd4" penwidth=1.2 arrowsize=0.8';
    //edge通用样式，这里可以给初始默认值
    private _subgraphs = new Map<string, Subgraph>(); // subgraph名字到subgraph的映射
    private _nodes = new Map<string, Node>(); // node名字到Node结构的映射
    private _edges: Edge[] = []; // 边的列表
    private _trimFlag: boolean = false; // 修剪标识，通过此标识控制是否需要根据节点的入度和出度进行修剪
    constructor(digraph_name?: string) {
        this._name = digraph_name || "G"; //设置名字
    }

    // ========== Getter/Setter 方法 ==========
    public getName(): string {
        return this._name;
    }

    public setName(name: string): void {
        this._name = name;
    }

    public getGraphStyle(): string {
        return this._graph_style;
    }

    public setGraphStyle(style: string): void {
        this._graph_style = style;
    }

    public getNodeStyle(): string {
        return this._node_style;
    }

    public setNodeStyle(style: string): void {
        this._node_style = style;
    }

    public getEdgeStyle(): string {
        return this._edge_style;
    }

    public setEdgeStyle(style: string): void {
        this._edge_style = style;
    }

    public getTrimFlag(): boolean {
        return this._trimFlag;
    }

    public setTrimFlag(flag: boolean): void {
        this._trimFlag = flag;
    }

    // ========== 节点操作 ==========

    /**
     * 添加节点
     */
    public addNode(node: Node): void {
        this._nodes.set(node.name, node);
    }

    /**
     * 获取节点
     */
    public getNode(name: string): Node | undefined {
        return this._nodes.get(name);
    }

    /**
     * 获取所有节点
     */
    public getAllNodes(): Map<string, Node> {
        return this._nodes;
    }

    /**
     * 删除节点
     */
    public removeNode(name: string): boolean {
        return this._nodes.delete(name);
    }

    // ========== 子图操作 ==========

    /**
     * 添加子图
     */
    public addSubgraph(subgraph: Subgraph): void {
        this._subgraphs.set(subgraph.name, subgraph);
    }

    /**
     * 获取子图
     */
    public getSubgraph(name: string): Subgraph | undefined {
        return this._subgraphs.get(name);
    }

    /**
     * 获取所有子图
     */
    public getAllSubgraphs(): Map<string, Subgraph> {
        return this._subgraphs;
    }

    // ========== 边操作 ==========

    /**
     * 添加边
     * 只有当 fromNode 和 toNode 都存在时才添加边
     */
    public addEdge(from: string, to: string, attrs?: string): void {
        // 检查节点是否存在
        const fromNode = this._nodes.get(from);
        const toNode = this._nodes.get(to);

        // 只有当两个节点都存在时才添加边
        if (!fromNode || !toNode) {
            return;
        }

        // 添加边
        this._edges.push({ from, to, attrs });

        // 更新节点的入度和出度
        fromNode.extAttrs.out_degree = (fromNode.extAttrs.out_degree || 0) + 1;
        toNode.extAttrs.in_degree = (toNode.extAttrs.in_degree || 0) + 1;
    }

    /**
     * 获取所有边
     */
    public getEdges(): Edge[] {
        return this._edges;
    }

    // ========== 图修剪 ==========

    /**
     * 根据入度和出度修剪图
     * 移除不必要的节点（保留不可裁剪的节点）
     *
     * 修剪策略：
     * 1. 保留所有 isTrimable=false 的节点（不可裁剪）
     * 2. 对于 isTrimable=true 的节点：
     *    - 移除孤立节点（入度=0 且 出度=0）
     *    - 移除叶子节点（出度=0 且 入度>0）
     *    - 保留根节点（入度=0 但 出度>0），因为它们是调用链的起点
     */
    public trimGraph(): void {
        if (!this._trimFlag) {
            return;
        }

        let changed = true;
        while (changed) {
            changed = false;
            const nodesToRemove: string[] = [];

            for (const [name, node] of this._nodes.entries()) {
                const inDegree = node.extAttrs.in_degree || 0;
                const outDegree = node.extAttrs.out_degree || 0;
                const isTrimable = node.extAttrs.isTrimable ?? false; // 默认为false，不可裁剪

                // 保留不可裁剪的节点
                if (!isTrimable) {
                    continue;
                }

                // 对于可裁剪的节点，移除以下情况：
                // 1. 孤立节点（入度=0 且 出度=0）
                // 2. 叶子节点（出度=0 且 入度>0）- 这些是调用链的终点
                if (
                    (inDegree === 0 && outDegree === 0) ||
                    (outDegree === 0 && inDegree > 0)
                ) {
                    nodesToRemove.push(name);
                    changed = true;
                }

                // 注意：不移除根节点（入度=0 但 出度>0），因为它们是调用链的起点

                // 注意：不移除根节点（入度=0 但 出度>0），因为它们是调用链的起点
            }

            // 移除节点并更新相关边
            for (const name of nodesToRemove) {
                this._nodes.delete(name);

                // 移除相关的边
                this._edges = this._edges.filter((edge) => {
                    if (edge.from === name || edge.to === name) {
                        // 更新度数
                        if (edge.from === name) {
                            const toNode = this._nodes.get(edge.to);
                            if (toNode && toNode.extAttrs.in_degree) {
                                toNode.extAttrs.in_degree--;
                            }
                        }
                        if (edge.to === name) {
                            const fromNode = this._nodes.get(edge.from);
                            if (fromNode && fromNode.extAttrs.out_degree) {
                                fromNode.extAttrs.out_degree--;
                            }
                        }
                        return false;
                    }
                    return true;
                });
            }
        }
    }

    // ========== 生成 DOT 字符串 ==========

    /**
     * 生成完整的 DOT 格式字符串
     */
    public toString(): string {
        let dot = `digraph ${this._name} {\n`;

        // Graph 样式
        dot += `  graph [${this._graph_style}]\n`;

        // Node 样式
        dot += `  node [${this._node_style}]\n`;

        // Edge 样式
        dot += `  edge [${this._edge_style}]\n`;

        // 添加子图

        for (const [name, subgraph] of this._subgraphs.entries()) {
            // 检查是否可见
            if (subgraph.extAttrs?.isVisible === false) {
                continue;
            }

            dot += this._buildSubgraph(subgraph, 1);
        }
        //让子图能够按字母排序
        // const sortedSubgraphs = [...this._subgraphs.values()]
        //     .sort((a, b) =>
        //         (a.label || a.name).localeCompare(b.label || b.name, "zh-CN"),
        //     )
        //     .reverse();

        // for (const subgraph of sortedSubgraphs) {
        //     if (subgraph.extAttrs?.isVisible === false) {
        //         continue;
        //     }
        //     dot += this._buildSubgraph(subgraph, 1);
        // }

        // 添加不在子图中的独立节点
        const nodesInSubgraphs = new Set<string>();

        // 递归收集所有子图（包括嵌套子图）中的节点
        const collectNodesFromSubgraph = (subgraph: Subgraph): void => {
            if (subgraph.nodeNames) {
                subgraph.nodeNames.forEach((n) => nodesInSubgraphs.add(n));
            }
            if (subgraph.childSubgraphs) {
                subgraph.childSubgraphs.forEach((child) =>
                    collectNodesFromSubgraph(child),
                );
            }
        };

        for (const subgraph of this._subgraphs.values()) {
            collectNodesFromSubgraph(subgraph);
        }

        // 添加边
        dot += this._buildEdges();
        dot += "}\n";
        return dot;
    }

    /**
     * 构建所有边的字符串
     * 假设所有节点已经在子图中定义，直接构建边即可
     */
    private _buildEdges(): string {
        let edgesDot = "";

        for (const edge of this._edges) {
            // 构建边
            const edgeAttrs = edge.attrs ? ` [${edge.attrs}]` : "";
            edgesDot += `  "${edge.from}" -> "${edge.to}"${edgeAttrs}\n`;
        }

        return edgesDot;
    }

    /**
     * 构建子图字符串（支持递归），支持每行最多4个节点横向排列，支持按字母排序
     */
    // private _buildSubgraph(subgraph: Subgraph, indent: number): string {
    //     const spaces = "  ".repeat(indent);
    //     let dot = `${spaces}subgraph "${subgraph.name}" {\n`;

    //     // 父图内部纵向排列
    //     dot += `${spaces}  rankdir=TB;\n`;

    //     if (subgraph.label) {
    //         dot += `${spaces}  label="${subgraph.label}"\n`;
    //     }
    //     if (subgraph.attrs) {
    //         dot += `${spaces}  ${subgraph.attrs}\n`;
    //     }

    //     if (subgraph.nodeNames && subgraph.nodeNames.length > 0) {
    //         const maxPerRow = 4;

    //         const nodeNames = [...subgraph.nodeNames].sort((a, b) => {
    //             const nodeA = this._nodes.get(a);
    //             const nodeB = this._nodes.get(b);

    //             const labelA = nodeA?.label ?? a;
    //             const labelB = nodeB?.label ?? b;

    //             return labelA.localeCompare(labelB, "zh-CN");
    //         });

    //         const remainder = nodeNames.length % maxPerRow;
    //         const lastRowStart =
    //             remainder === 0
    //                 ? nodeNames.length - maxPerRow
    //                 : nodeNames.length - remainder;

    //         for (let i = lastRowStart; i >= 0; i -= maxPerRow) {
    //             const rowNodes = nodeNames.slice(i, i + maxPerRow);

    //             for (const nodeName of rowNodes) {
    //                 const node = this._nodes.get(nodeName);
    //                 if (node) {
    //                     const attrs = node.attrs
    //                         ? `${node.attrs} width=2.5`
    //                         : "width=2.5";
    //                     dot += `${spaces}  "${node.name}" [label="${node.label}" ${attrs}]\n`;
    //                 }
    //             }

    //             // 横向 invisible edge（顺序保持不变）
    //             for (let j = 0; j < rowNodes.length - 1; j++) {
    //                 dot += `${spaces}  "${rowNodes[j]}" -> "${rowNodes[j + 1]}" [style=invis, dir=none];\n`;
    //             }
    //         }
    //     }

    //     // 递归添加子子图
    //     if (subgraph.childSubgraphs && subgraph.childSubgraphs.length > 0) {
    //         subgraph.childSubgraphs
    //             .slice() // 不破坏原数组（很重要）
    //             .sort((a, b) =>
    //                 (a.label || a.name).localeCompare(
    //                     b.label || b.name,
    //                     "zh-CN",
    //                 ),
    //             )
    //             .reverse()
    //             .forEach((child) => {
    //                 dot += this._buildSubgraph(child, indent + 1);
    //             });
    //     }

    //     dot += `${spaces}}\n`;
    //     return dot;
    // }

    /**
     * 构建子图字符串（支持递归）
     */
    private _buildSubgraph(subgraph: Subgraph, indent: number): string {
        const spaces = "  ".repeat(indent);
        let dot = `${spaces}subgraph "${subgraph.name}" {\n`;

        // 子图属性
        if (subgraph.label) {
            dot += `${spaces}  label="${subgraph.label}"\n`;
        }
        if (subgraph.attrs) {
            dot += `${spaces}  ${subgraph.attrs}\n`;
        }

        // 添加节点
        if (subgraph.nodeNames) {
            for (const nodeName of subgraph.nodeNames) {
                const node = this._nodes.get(nodeName);
                if (node) {
                    dot += this._buildNode(node, indent + 1);
                }
            }
        }

        // 递归添加子子图
        if (subgraph.childSubgraphs) {
            for (const child of subgraph.childSubgraphs) {
                dot += this._buildSubgraph(child, indent + 1);
            }
        }

        dot += `${spaces}}\n`;
        return dot;
    }
    /**
     * 构建节点字符串
     */
    private _buildNode(node: Node, indent: number): string {
        const spaces = "  ".repeat(indent);
        const attrs = node.attrs
            ? ` [label="${node.label}" ${node.attrs}]`
            : ` [label="${node.label}"]`;

        return `${spaces}"${node.name}"${attrs}\n`;
    }
}
