import * as vscode from "vscode";
import { createDotHeader } from "./utils/common";
// import { analyzeRangesByAST } from "./utils/common";
import { Range } from "vscode";
import {
    findFirstSymbolFromEnd,
    findFirstSymbolFromBeginning,
} from "./utils/common";
import { Log } from "../util/logger";
// const tipStr = "Tips: Ctrl+Left Click to jump to the function\n";
const isReferenceReadWriteEnable = true;

// export class ReferGraph {
//     private _dot = "";
//     private _dot_edge = "";
//     private _dot_edge_subgraph = "";
//     private _dot_ref_node_subgraph = "";

//     constructor(title?: string) {
//         this._dot = createDotHeader(title);
//     }
//     //这个addnode方法跟ReferMultipleGraph的addnode方法一模一样
//     public async addNode(
//         selectedText: string,
//         ref_callGraphs: Map<string, Set<string>>,
//         ref_functions_map_range: Map<string, Range[]>,
//         selected_text_uri: string,
//     ) {
//         for (const [children, fathers] of ref_callGraphs.entries()) {
//             // children fathers格式  xxx.cpp#方法名@行号:列号
//             const childrenKey = children.split("@")[0];
//             const childrenRanges = ref_functions_map_range.get(childrenKey);
//             const childRefCount = childrenRanges?.length ?? "";
//             let dot_ref_children_name = tipStr + children;

//             let readCount = 0,
//                 writeCount = 0,
//                 referenceCount = 0;
//             if (childrenRanges) {
//                 const astCounts = await analyzeRangesByAST(
//                     childrenKey.split("#")[0],
//                     childrenRanges,
//                     selectedText,
//                 );
//                 readCount = astCounts.readCount;
//                 writeCount = astCounts.writeCount;
//                 referenceCount = astCounts.referenceCount;
//                 let index = 1;
//                 for (const range of childrenRanges) {
//                     dot_ref_children_name += `\n${index}.line ${range.start.line + 1}:${range.start.character}~${range.end.line + 1}:${range.end.character}`;
//                     index++;
//                 }
//             }
//             let childrenLabel = children.split("#")[1].split("@")[0];
//             if (childRefCount) {
//                 // 只展示有数量的统计项
//                 const infoArr = [];
//                 if (readCount > 0) infoArr.push(`read:${readCount}`);
//                 if (writeCount > 0) infoArr.push(`write:${writeCount}`);
//                 if (referenceCount > 0)
//                     infoArr.push(`reference:${referenceCount}`);
//                 const infoStr =
//                     infoArr.length > 0 ? `\n${infoArr.join(" ")}` : "";
//                 childrenLabel += isReferenceReadWriteEnable
//                     ? ` (${childRefCount})${infoStr}`
//                     : ` (${childRefCount})`;
//             }
//             for (const father of fathers) {
//                 if (father) {
//                     const fatherKey = father.split("@")[0];
//                     const fatherRanges = ref_functions_map_range.get(fatherKey);
//                     let fatherLabel = father.split("#")[1].split("@")[0];
//                     const fatherRefCount = fatherRanges?.length ?? "";

//                     //sameFile 是用来判断父子节点在不在同一个文件里 如果是同一个文件里 那就用红色虚线
//                     const sameFile =
//                         father.split("#")[0] === children.split("#")[0];

//                     let dot_ref_father_name = tipStr + father;
//                     // 新增：统计 read/write/reference
//                     let fatherReadCount = 0,
//                         fatherWriteCount = 0,
//                         fatherReferenceCount = 0;
//                     if (fatherRanges) {
//                         const astCounts = await analyzeRangesByAST(
//                             fatherKey.split("#")[0],
//                             fatherRanges,
//                             fatherLabel,
//                         );
//                         fatherReadCount = astCounts.readCount;
//                         fatherWriteCount = astCounts.writeCount;
//                         fatherReferenceCount = astCounts.referenceCount;

//                         let index = 1;
//                         for (const range of fatherRanges) {
//                             dot_ref_father_name += `\n${index}.line ${range.start.line + 1}:${range.start.character}~${range.end.line + 1}:${range.end.character}`;
//                             index++;
//                         }
//                     }

//                     if (isReferenceReadWriteEnable && fatherRefCount) {
//                         // 只展示有数量的统计项
//                         const infoArr = [];
//                         if (fatherReadCount > 0)
//                             infoArr.push(`read:${fatherReadCount}`);
//                         if (fatherWriteCount > 0)
//                             infoArr.push(`write:${fatherWriteCount}`);
//                         if (fatherReferenceCount > 0)
//                             infoArr.push(`reference:${fatherReferenceCount}`);
//                         const infoStr =
//                             infoArr.length > 0 ? `\n${infoArr.join(" ")}` : "";
//                         fatherLabel += ` (${fatherRefCount})${infoStr}`;
//                     }
//                     const edgeStyle = sameFile
//                         ? ' [style="dashed", color="#dc3545", arrowhead="vee"]'
//                         : "";

//                     this._dot_edge += `{"${dot_ref_father_name}"[label="${fatherLabel}"]} -> {"${dot_ref_children_name}"[label="${childrenLabel}"] }${edgeStyle}\n`;

//                     // === 父函数子图 ===
//                     const subgraph_father_path = father.split("#")[0];
//                     let ref_subgraph_father_label: string;
//                     if (subgraph_father_path.includes("uplane/")) {
//                         ref_subgraph_father_label = subgraph_father_path
//                             .split("uplane/")
//                             .pop()!;
//                     } else {
//                         ref_subgraph_father_label = subgraph_father_path;
//                     }
//                     this._dot_edge_subgraph += `subgraph "cluster_${subgraph_father_path}" {
//                     style="rounded,dashed";
//                     labelloc="t";
//                     label="${ref_subgraph_father_label}";
//                     "${dot_ref_father_name}"[label="${fatherLabel}"];
//                     }\n`;
//                 }
//             }
//             // === 子函数子图 ===
//             const subgraph_children_path = children.split("#")[0];
//             let ref_subgraph_children_label: string;
//             if (subgraph_children_path.includes("uplane/")) {
//                 ref_subgraph_children_label = subgraph_children_path
//                     .split("uplane/")
//                     .pop()!;
//             } else {
//                 ref_subgraph_children_label = subgraph_children_path;
//             }
//             this._dot_edge_subgraph += `subgraph "cluster_${subgraph_children_path}" {
//                     style="rounded,dashed";
//                     labelloc="t";
//                     label="${ref_subgraph_children_label}";
//                     "${dot_ref_children_name}"[label="${childrenLabel}"];
//                     }\n`;
//             if (childrenRanges) {
//                 this._dot_edge += `{"${dot_ref_children_name}"[label="${childrenLabel}"]} -> {"${tipStr}${selected_text_uri}"[label="${selectedText}"]}[color=black]\n`;
//             }
//         }

//         // === 高亮 selectedText 函数节点 ===
//         this._dot_edge_subgraph += `"${tipStr}${selected_text_uri}" [
//         label="${selectedText}";
//         style="rounded,filled";
//         color="black";
//         fillcolor="#e4ffb5";
//         fontname="Consolas"
//         ]\n`;
//     }

//     toString() {
//         let sub = "";
//         return (
//             this._dot +
//             this._dot_edge +
//             this._dot_edge_subgraph +
//             this._dot_ref_node_subgraph +
//             "}\n"
//         );
//     }
// }

// export class ReferOverLimitGraph {
//     private _dot = "";
//     private _node = "";
//     constructor(title?: string) {
//         this._dot = createDotHeader(title);
//     }

//     public async addNode(
//         uri2RangesMap: Map<string, vscode.Range[]>,
//         selected_text: string,
//         selected_text_uri: string,
//     ) {
//         // 遍历 uri2RangesMap
//         for (const [uri, ranges] of uri2RangesMap.entries()) {
//             let symbolId = tipStr + `${uri}#@0:0`; // 使用 uri 作为唯一标识符
//             // 调用 analyzeRangesByAST 进行统计
//             const counts = await analyzeRangesByAST(uri, ranges, selected_text);
//             for (let index = 0; index < ranges.length; index++) {
//                 const range = ranges[index];
//                 symbolId += `\n${index + 1}.line ${range.start.line + 1}:${range.start.character}~${range.end.line + 1}:${range.end.character}`;
//             }
//             // 处理 uri，如果包含 uplane/，只截取其后部分
//             let displayUri = uri;
//             const keyword = "uplane/";
//             const index = uri.indexOf(keyword);
//             if (index !== -1) {
//                 displayUri = uri.substring(index + keyword.length);
//             }

//             //判断是否展示
//             const infoArr = [];
//             if (counts.readCount > 0) infoArr.push(`read:${counts.readCount}`);
//             if (counts.writeCount > 0)
//                 infoArr.push(`write:${counts.writeCount}`);
//             if (counts.referenceCount > 0)
//                 infoArr.push(`reference:${counts.referenceCount}`);
//             const infoStr = infoArr.length > 0 ? `\n${infoArr.join(" ")}` : "";

//             //展示统计信息
//             const labelBase = `${displayUri} (${ranges.length})`;
//             const label = isReferenceReadWriteEnable
//                 ? `${displayUri} (${ranges.length})${infoStr}`
//                 : `${displayUri} (${ranges.length})`; // 加上调用次数
//             this._dot += `{"${symbolId}"[label="${label}"]} -> {"${tipStr}${selected_text_uri}"[label="${selected_text}"]}[color=black]\n`;
//             if (labelBase.includes(selected_text)) {
//                 this._node += `"${symbolId}" [
//             label="${label}";
//             style="rounded,filled";
//             color="black";
//             fillcolor="#e4ffb5";
//             fontname="Consolas"
//             ]\n`;
//             }
//         }

//         // === 高亮 selectedText 函数节点 ===
//         this._dot += `"${tipStr}${selected_text_uri}" [
//         label="${selected_text}";
//         style="rounded,filled";
//         color="black";
//         fillcolor="#e4ffb5";
//         fontname="Consolas"
//         ]\n`;
//         // return this._dot + "}\n";
//     }
//     toString() {
//         return this._dot + this._node + "}\n";
//     }
// }

// export class ReferMultipleGraph {
//     private _dot = "";
//     private _dot_edge = "";
//     private _dot_edge_subgraph = "";

//     constructor(title?: string) {
//         this._dot = createDotHeader(title);
//     }
//     //这个addnode方法跟ReferGraph的addnode方法一模一样
//     public async addNode(
//         ref_callGraphs: Map<string, Set<string>>,
//         selectedTextWithUri: string,
//         ref_functions_map_range: Map<string, vscode.Range[]>,
//     ) {
//         const selectTextLabel = selectedTextWithUri.split("#")[1].split("@")[0];
//         for (const [children, fathers] of ref_callGraphs.entries()) {
//             const childrenKey = children.split("@")[0];
//             const childrenRanges = ref_functions_map_range.get(childrenKey);
//             let childrenLabel = children.split("#")[1].split("@")[0];
//             const childRefCount = childrenRanges?.length ?? "";
//             let dot_ref_children_name = tipStr + children;

//             // 统计 read/write/reference
//             let readCount = 0,
//                 writeCount = 0,
//                 referenceCount = 0;

//             if (childrenRanges) {
//                 let index = 1;
//                 const astCounts = await analyzeRangesByAST(
//                     childrenKey.split("#")[0],
//                     childrenRanges,
//                     selectTextLabel,
//                 );
//                 readCount = astCounts.readCount;
//                 writeCount = astCounts.writeCount;
//                 referenceCount = astCounts.referenceCount;
//             }
//             if (isReferenceReadWriteEnable && childRefCount) {
//                 // 只展示有数量的统计项
//                 const infoArr = [];
//                 if (readCount > 0) infoArr.push(`read:${readCount}`);
//                 if (writeCount > 0) infoArr.push(`write:${writeCount}`);
//                 if (referenceCount > 0)
//                     infoArr.push(`reference:${referenceCount}`);
//                 const infoStr =
//                     infoArr.length > 0 ? `\n${infoArr.join(" ")}` : "";
//                 childrenLabel += isReferenceReadWriteEnable
//                     ? ` (${childRefCount})${infoStr}`
//                     : ` (${childRefCount})`;
//             }

//             for (const father of fathers) {
//                 if (father) {
//                     const fatherKey = father.split("@")[0];
//                     const fatherRanges = ref_functions_map_range.get(fatherKey);
//                     let fatherLabel = father.split("#")[1].split("@")[0];
//                     const fatherRefCount = fatherRanges?.length ?? "";

//                     // 统计 father 的 read/write/reference
//                     let fatherReadCount = 0,
//                         fatherWriteCount = 0,
//                         fatherReferenceCount = 0;

//                     const sameFile =
//                         father.split("#")[0] === children.split("#")[0];

//                     let dot_ref_father_name = tipStr + father;

//                     if (fatherRanges) {
//                         const astCounts = await analyzeRangesByAST(
//                             fatherKey.split("#")[0],
//                             fatherRanges,
//                             fatherLabel,
//                         );
//                         fatherReadCount = astCounts.readCount;
//                         fatherWriteCount = astCounts.writeCount;
//                         fatherReferenceCount = astCounts.referenceCount;
//                     }
//                     if (isReferenceReadWriteEnable && fatherRefCount) {
//                         // 只展示有数量的统计项
//                         const infoArr = [];
//                         if (fatherReadCount > 0)
//                             infoArr.push(`read:${fatherReadCount}`);
//                         if (fatherWriteCount > 0)
//                             infoArr.push(`write:${fatherWriteCount}`);
//                         if (fatherReferenceCount > 0)
//                             infoArr.push(`reference:${fatherReferenceCount}`);
//                         const infoStr =
//                             infoArr.length > 0 ? `\n${infoArr.join(" ")}` : "";
//                         fatherLabel += ` (${fatherRefCount})${infoStr}`;
//                     }

//                     const edgeStyle = sameFile
//                         ? ' [style="dashed", color="#dc3545", arrowhead="vee"]'
//                         : "";

//                     this._dot_edge += `{"${dot_ref_father_name}"[label="${fatherLabel}"]} -> {"${dot_ref_children_name}"[label="${childrenLabel}"] }${edgeStyle}\n`;

//                     // === 父函数子图 ===
//                     const subgraph_father_path = father.split("#")[0];
//                     let ref_subgraph_father_label: string;
//                     if (subgraph_father_path.includes("uplane/")) {
//                         ref_subgraph_father_label = subgraph_father_path
//                             .split("uplane/")
//                             .pop()!;
//                     } else {
//                         ref_subgraph_father_label = subgraph_father_path;
//                     }
//                     this._dot_edge_subgraph += `subgraph "cluster_${subgraph_father_path}" {
//                     style="rounded,dashed";
//                     labelloc="t";
//                     label="${ref_subgraph_father_label}";
//                     "${dot_ref_father_name}"[label="${fatherLabel}"];
//                     }\n`;
//                 }
//             }
//             // === 子函数子图 ===
//             const subgraph_children_path = children.split("#")[0];
//             let ref_subgraph_children_label: string;
//             if (subgraph_children_path.includes("uplane/")) {
//                 ref_subgraph_children_label = subgraph_children_path
//                     .split("uplane/")
//                     .pop()!;
//             } else {
//                 ref_subgraph_children_label = subgraph_children_path;
//             }
//             this._dot_edge_subgraph += `subgraph "cluster_${subgraph_children_path}" {
//                     style="rounded,dashed";
//                     labelloc="t";
//                     label="${ref_subgraph_children_label}";
//                     "${dot_ref_children_name}"[label="${childrenLabel}"];
//                     }\n`;
//             if (childrenRanges) {
//                 this._dot_edge += `{"${dot_ref_children_name}"[label="${childrenLabel}"]} -> {"${tipStr}${selectedTextWithUri}"[label="${selectTextLabel}"]}[color=black]\n`;
//             }
//         }

//         // === 高亮 selectedText 函数节点 ===
//         this._dot_edge_subgraph += `"${tipStr}${selectedTextWithUri}" [
//         label="${selectTextLabel}";
//         style="rounded,filled";
//         color="black";
//         fillcolor="#e4ffb5";
//         fontname="Consolas"
//         ]\n`;
//     }

//     toString() {
//         let sub = "";
//         // 返回最终拼接的 dot 内容
//         return (
//             this._dot + this._dot_edge + this._dot_edge_subgraph + sub + "}\n"
//         );
//     }
// }
export class ReferGraph {
    private _dot = "";
    private _dot_edge = "";
    private _dot_edge_subgraph = "";
    private _dot_ref_node_subgraph = "";

    constructor(title?: string) {
        this._dot = createDotHeader(title);
    }
    //这个addnode方法跟ReferMultipleGraph的addnode方法一模一样
    public async addNode(
        selectedText: string,
        ref_callGraphs: Map<string, Set<string>>,
        ref_functions_map_range: Map<string, Range[]>,
        selected_text_uri: string,
    ) {
        for (const [children, fathers] of ref_callGraphs.entries()) {
            // children fathers格式  xxx.cpp#方法名@行号:列号
            const childrenKey = children.split("@")[0];
            const childrenRanges = ref_functions_map_range.get(childrenKey);
            const childRefCount = childrenRanges?.length ?? "";
            let dot_ref_children_name = children;

            let readCount = 0,
                writeCount = 0,
                referenceCount = 0;
            if (childrenRanges) {
                let index = 1;
                for (const range of childrenRanges) {
                    dot_ref_children_name += `\n${index}.line ${range.start.line}:${range.start.character}~${range.end.line}:${range.end.character}`;
                    // 获取从首行第1个字符到当前光标处的字符串
                    let fullText = "";
                    try {
                        const doc = await vscode.workspace.openTextDocument(
                            childrenKey.split("#")[0],
                        );
                        const textRange = new vscode.Range(
                            0,
                            0,
                            range.start.line,
                            range.start.character,
                        );
                        fullText = doc.getText(textRange);
                    } catch {
                        fullText = "";
                    }
                    // 用 findFirstSymbolFromEnd 判断
                    const symbol = findFirstSymbolFromEnd(fullText, [
                        ";",
                        "{",
                        "}",
                        "&",
                        "=",
                    ]);
                    if (symbol === ";" || symbol === "{" || symbol === "}") {
                        writeCount++;
                    } else if (symbol === "&") {
                        referenceCount++;
                    } else if (symbol === "=") {
                        readCount++;
                    } else {
                        readCount++;
                    }
                    index++;
                }
            }
            let childrenLabel = children.split("#")[1].split("@")[0];
            if (childRefCount) {
                const infoArr = [];
                if (readCount > 0) {infoArr.push(`read:${readCount}`);}
                if (writeCount > 0) {infoArr.push(`write:${writeCount}`);}
                if (referenceCount > 0)
                    {infoArr.push(`reference:${referenceCount}`);}
                const infoStr =
                    infoArr.length > 0 ? `\n${infoArr.join(" ")}` : "";
                childrenLabel += isReferenceReadWriteEnable
                    ? ` (${childRefCount})${infoStr}`
                    : ` (${childRefCount})`;
            }
            for (const father of fathers) {
                if (father) {
                    const fatherKey = father.split("@")[0];
                    const fatherRanges = ref_functions_map_range.get(fatherKey);
                    let fatherLabel = father.split("#")[1].split("@")[0];
                    const fatherRefCount = fatherRanges?.length ?? "";

                    //sameFile 是用来判断父子节点在不在同一个文件里 如果是同一个文件里 那就用红色虚线
                    const sameFile =
                        father.split("#")[0] === children.split("#")[0];

                    let dot_ref_father_name = father;
                    // 新增：统计 read/write/reference
                    let fatherReadCount = 0,
                        fatherWriteCount = 0,
                        fatherReferenceCount = 0;
                    if (fatherRanges) {
                        let index = 1;
                        for (const range of fatherRanges) {
                            dot_ref_father_name += `\n${index}.line ${range.start.line}:${range.start.character}~${range.end.line}:${range.end.character}`;

                            let fullText = "";
                            try {
                                const doc =
                                    await vscode.workspace.openTextDocument(
                                        fatherKey.split("#")[0],
                                    );
                                // 用 vscode.Range 一次性获取多行文本
                                const textRange = new vscode.Range(
                                    0,
                                    0,
                                    range.start.line,
                                    range.start.character,
                                );
                                fullText = doc.getText(textRange);
                            } catch {
                                fullText = "";
                            }
                            // 用 findFirstSymbolFromEnd 判断
                            const symbol = findFirstSymbolFromEnd(fullText, [
                                ";",
                                "{",
                                "}",
                                "&",
                                "=",
                            ]);
                            if (
                                symbol === ";" ||
                                symbol === "{" ||
                                symbol === "}"
                            ) {
                                fatherWriteCount++;
                            } else if (symbol === "&") {
                                fatherReferenceCount++;
                            } else if (symbol === "=") {
                                fatherReadCount++;
                            } else {
                                fatherReadCount++;
                            }
                            index++;
                        }
                    }

                    if (isReferenceReadWriteEnable && fatherRefCount) {
                        const infoArr = [];
                        if (fatherReadCount > 0)
                            {infoArr.push(`read:${fatherReadCount}`);}
                        if (fatherWriteCount > 0)
                            {infoArr.push(`write:${fatherWriteCount}`);}
                        if (fatherReferenceCount > 0)
                            {infoArr.push(`reference:${fatherReferenceCount}`);}
                        const infoStr =
                            infoArr.length > 0 ? `\n${infoArr.join(" ")}` : "";
                        fatherLabel += ` (${fatherRefCount})${infoStr} `;
                    }
                    const edgeStyle = sameFile
                        ? ' [style="dashed", color="#dc3545", arrowhead="vee"]'
                        : "";

                    this._dot_edge += `{"${dot_ref_father_name}"[label="${fatherLabel}"]} -> {"${dot_ref_children_name}"[label="${childrenLabel}"] }${edgeStyle}\n`;

                    // === 父函数子图 ===
                    const subgraph_father_path = father.split("#")[0];
                    let ref_subgraph_father_label: string;
                    if (subgraph_father_path.includes("uplane/")) {
                        ref_subgraph_father_label = subgraph_father_path
                            .split("uplane/")
                            .pop()!;
                    } else {
                        ref_subgraph_father_label = subgraph_father_path;
                    }
                    this._dot_edge_subgraph += `subgraph "cluster_${subgraph_father_path}" {
                    style="rounded,dashed";
                    labelloc="t";
                    label="${ref_subgraph_father_label}";
                    "${dot_ref_father_name}"[label="${fatherLabel}"];
                    }\n`;
                }
            }
            // === 子函数子图 ===
            const subgraph_children_path = children.split("#")[0];
            let ref_subgraph_children_label: string;
            if (subgraph_children_path.includes("uplane/")) {
                ref_subgraph_children_label = subgraph_children_path
                    .split("uplane/")
                    .pop()!;
            } else {
                ref_subgraph_children_label = subgraph_children_path;
            }
            this._dot_edge_subgraph += `subgraph "cluster_${subgraph_children_path}" {
                    style="rounded,dashed";
                    labelloc="t";
                    label="${ref_subgraph_children_label}";
                    "${dot_ref_children_name}"[label="${childrenLabel}"];
                    }\n`;
            if (childrenRanges) {
                this._dot_edge += `{"${dot_ref_children_name}"[label="${childrenLabel}"]} -> {"${selected_text_uri}"[label="${selectedText}"]}[color=black]\n`;
            }
        }

        // === 高亮 selectedText 函数节点 ===
        this._dot_edge_subgraph += `"${selected_text_uri}" [
        label="${selectedText}";
        style="rounded,filled";
        color="black";
        fillcolor="#e4ffb5";
        fontname="Consolas"
        ]\n`;
    }

    toString() {
        let sub = "";
        return (
            this._dot +
            this._dot_edge +
            this._dot_edge_subgraph +
            this._dot_ref_node_subgraph +
            "}\n"
        );
    }
}

export class ReferOverLimitGraph {
    private _dot = "";
    private _node = "";
    constructor(title?: string) {
        this._dot = createDotHeader(title);
    }

    public async addNode(
        uri2RangesMap: Map<string, vscode.Range[]>,
        selected_text: string,
        selected_text_uri: string,
    ) {
        for (const [uri, ranges] of uri2RangesMap.entries()) {
            let symbolId = `${uri}`;
            if (ranges.length > 0) {
                const first = ranges[0];
                symbolId += `#@${first.start.line + 1}:${first.start.character}`;
            }
            // 统计 read/write/reference
            let readCount = 0,
                writeCount = 0,
                referenceCount = 0;
            for (let index = 0; index < ranges.length; index++) {
                const range = ranges[index];
                symbolId += `\n${index + 1}.line ${range.start.line}:${range.start.character}~${range.end.line}:${range.end.character}`;
                let textBeforeCursor = "";
                let textAfterCursor = "";
                try {
                    const doc = await vscode.workspace.openTextDocument(
                        uri.split("#")[0],
                    );
                    // 获取首部到光标处
                    const rangeBefore = new vscode.Range(
                        0,
                        0,
                        range.start.line - 1, //由于在buildUriToRangesMap方法中做了+1处理，故此处传入的range.start.line是行号不是索引，此处需填入的是索引，故-1
                        range.start.character,
                    );
                    textBeforeCursor = doc.getText(rangeBefore);

                    // 获取光标到末尾
                    const endLine = doc.lineCount - 1;
                    const endChar = doc.lineAt(endLine).text.length;
                    const rangeAfter = new vscode.Range(
                        range.start.line - 1, //由于在buildUriToRangesMap方法中做了+1处理，故此处传入的range.start.line是行号不是索引，此处需填入的是索引，故-1
                        range.start.character,
                        endLine,
                        endChar,
                    );
                    textAfterCursor = doc.getText(rangeAfter);
                } catch {
                    textBeforeCursor = "";
                    textAfterCursor = "";
                }
                const symbol = findFirstSymbolFromEnd(textBeforeCursor, [
                    ";",
                    "{",
                    "}",
                    "&",
                    "=",
                ]);
                if (symbol === ";" || symbol === "{" || symbol === "}") {
                    if (findFirstSymbolFromBeginning(textAfterCursor)) {
                        writeCount++;
                    } else {
                        readCount++;
                    }
                } else if (symbol === "&") {
                    referenceCount++;
                } else if (symbol === "=") {
                    readCount++;
                } else {
                    readCount++;
                }
            }

            // 处理 uri，如果包含 uplane/，只截取其后部分
            let displayUri = uri;
            const keyword = "uplane/";
            const index = uri.indexOf(keyword);
            if (index !== -1) {
                displayUri = uri.substring(index + keyword.length);
            }
            //展示统计信息
            const labelBase = `${displayUri} (${ranges.length})`;
            const infoArr = [];
            if (readCount >= 0) {infoArr.push(`read:${readCount}`);}
            if (writeCount >= 0) {infoArr.push(`write:${writeCount}`);}
            if (referenceCount > 0) {infoArr.push(`reference:${referenceCount}`);}
            const infoStr =
                infoArr.length >= 0 ? `\n(${infoArr.join(",")})` : "";
            const label = isReferenceReadWriteEnable
                ? `${displayUri} (${ranges.length})${infoStr}`
                : `${displayUri} (${ranges.length})`; // 加上调用次数
            this._dot += `{"${symbolId}"[label="${label}"]} -> {"${selected_text_uri}"[label="${selected_text}"]}[color=black]\n`;
            if (labelBase.includes(selected_text)) {
                this._node += `"${symbolId}" [
            label="${label}";
            style="rounded,filled";
            color="black";
            fillcolor="#e4ffb5";
            fontname="Consolas"
            ]\n`;
            }
        }

        // === 高亮 selectedText 函数节点 ===
        this._dot += `"${selected_text_uri}" [
        label="${selected_text}";
        style="rounded,filled";
        color="black";
        fillcolor="#e4ffb5";
        fontname="Consolas"
        ]\n`;
        // return this._dot + "}\n";
    }
    toString() {
        return this._dot + this._node + "}\n";
    }
}

export class ReferMultipleGraph {
    private _dot = "";
    private _dot_edge = "";
    private _dot_edge_subgraph = "";

    constructor(title?: string) {
        this._dot = createDotHeader(title);
    }
    //这个addnode方法跟ReferGraph的addnode方法一模一样
    public async addNode(
        ref_callGraphs: Map<string, Set<string>>,
        selectedTextWithUri: string,
        ref_functions_map_range: Map<string, vscode.Range[]>,
    ) {
        const selectTextLabel = selectedTextWithUri.split("#")[1].split("@")[0];
        for (const [children, fathers] of ref_callGraphs.entries()) {
            const childrenKey = children.split("@")[0];

            const childrenRanges = ref_functions_map_range.get(childrenKey);
            let childrenLabel = children.split("#")[1].split("@")[0];
            const childRefCount = childrenRanges?.length ?? "";
            let dot_ref_children_name = children;

            // 统计 read/write/reference
            let readCount = 0,
                writeCount = 0,
                referenceCount = 0;

            if (childrenRanges) {
                let index = 1;
                for (const range of childrenRanges) {
                    dot_ref_children_name += `\n${index}.line ${range.start.line}:${range.start.character}~${range.end.line}:${range.end.character}`;
                    // 获取从首行第1个字符到当前光标处的字符串
                    let textBeforeCursor = "";
                    let textAfterCursor = "";
                    try {
                        const doc = await vscode.workspace.openTextDocument(
                            childrenKey.split("#")[0],
                        );
                        const rangeBefore = new vscode.Range(
                            0,
                            0,
                            range.start.line - 1, //由于在buildUriToRangesMap方法中做了+1处理，故此处传入的range.start.line是行号不是索引，此处需填入的是索引，故-1
                            range.start.character,
                        );
                        textBeforeCursor = doc.getText(rangeBefore);
                        //获取光标到末尾
                        const endLine = doc.lineCount - 1;
                        const endChar = doc.lineAt(endLine).text.length;
                        const rangeAfter = new vscode.Range(
                            range.start.line - 1, //由于在buildUriToRangesMap方法中做了+1处理，故此处传入的range.start.line是行号不是索引，此处需填入的是索引，故-1
                            range.start.character,
                            endLine,
                            endChar,
                        );
                        textAfterCursor = doc.getText(rangeAfter);
                    } catch {
                        textBeforeCursor = "";
                        textAfterCursor = "";
                    }
                    // 用 findFirstSymbolFromEnd 判断
                    const symbol = findFirstSymbolFromEnd(textBeforeCursor, [
                        ";",
                        "{",
                        "}",
                        "&",
                        "=",
                    ]);
                    if (symbol === ";" || symbol === "{" || symbol === "}") {
                        if (findFirstSymbolFromBeginning(textAfterCursor)) {
                            writeCount++;
                        } else {
                            readCount++;
                        }
                    } else if (symbol === "&") {
                        referenceCount++;
                    } else if (symbol === "=") {
                        readCount++;
                    } else {
                        readCount++;
                    }
                    index++;
                }
            }
            if (isReferenceReadWriteEnable && childRefCount) {
                const infoArr = [];
                if (readCount >= 0) {infoArr.push(`read:${readCount}`);}
                if (writeCount >= 0) {infoArr.push(`write:${writeCount}`);}
                if (referenceCount > 0)
                    {infoArr.push(`reference:${referenceCount}`);}
                const infoStr =
                    infoArr.length >= 0 ? `\n(${infoArr.join(",")})` : "";
                childrenLabel += ` (${childRefCount})${infoStr} `;
            }

            for (const father of fathers) {
                if (father) {
                    const fatherKey = father.split("@")[0];
                    const fatherRanges = ref_functions_map_range.get(fatherKey);
                    let fatherLabel = father.split("#")[1].split("@")[0];
                    const fatherRefCount = fatherRanges?.length ?? "";

                    // 统计 father 的 read/write/reference
                    let fatherReadCount = 0,
                        fatherWriteCount = 0,
                        fatherReferenceCount = 0;

                    const sameFile =
                        father.split("#")[0] === children.split("#")[0];

                    let dot_ref_father_name = father;

                    if (fatherRanges) {
                        let index = 1;
                        for (const range of fatherRanges) {
                            dot_ref_father_name += `\n${index}.line ${range.start.line}:${range.start.character}~${range.end.line}:${range.end.character}`;
                            // 获取从首行第1个字符到当前光标处的字符串
                            let textBeforeCursor = "";
                            let textAfterCursor = "";
                            try {
                                const doc =
                                    await vscode.workspace.openTextDocument(
                                        fatherKey.split("#")[0],
                                    );
                                const rangeBefore = new vscode.Range(
                                    0,
                                    0,
                                    range.start.line - 1,
                                    range.start.character,
                                );
                                textBeforeCursor = doc.getText(rangeBefore);
                                //获取光标到末尾
                                const endLine = doc.lineCount - 1;
                                const endChar = doc.lineAt(endLine).text.length;
                                const rangeAfter = new vscode.Range(
                                    range.start.line - 1,
                                    range.start.character,
                                    endLine,
                                    endChar,
                                );
                                textAfterCursor = doc.getText(rangeAfter);
                            } catch {
                                textBeforeCursor = "";
                                textAfterCursor = "";
                            }
                            // 用 findFirstSymbolFromEnd 判断
                            const symbol = findFirstSymbolFromEnd(
                                textBeforeCursor,
                                [";", "{", "}", "&", "="],
                            );
                            if (
                                symbol === ";" ||
                                symbol === "{" ||
                                symbol === "}"
                            ) {
                                if (
                                    findFirstSymbolFromBeginning(
                                        textAfterCursor,
                                    )
                                ) {
                                    fatherWriteCount++;
                                } else {
                                    fatherReadCount++;
                                }
                            } else if (symbol === "&") {
                                fatherReferenceCount++;
                            } else if (symbol === "=") {
                                fatherReadCount++;
                            } else {
                                fatherReadCount++;
                            }
                            index++;
                        }
                    }
                    if (isReferenceReadWriteEnable && fatherRefCount) {
                        const infoArr = [];
                        if (fatherReadCount >= 0)
                            {infoArr.push(`read:${fatherReadCount}`);}
                        if (fatherWriteCount >= 0)
                            {infoArr.push(`write:${fatherWriteCount}`);}
                        if (fatherReferenceCount > 0)
                            {infoArr.push(`reference:${fatherReferenceCount}`);}
                        const infoStr =
                            infoArr.length >= 0
                                ? `\n(${infoArr.join(",")})`
                                : "";
                        fatherLabel += ` (${fatherRefCount})${infoStr} `;
                    }

                    const edgeStyle = sameFile
                        ? ' [style="dashed", color="#dc3545", arrowhead="vee"]'
                        : "";

                    this._dot_edge += `{"${dot_ref_father_name}"[label="${fatherLabel}"]} -> {"${dot_ref_children_name}"[label="${childrenLabel}"] }${edgeStyle}\n`;

                    // === 父函数子图 ===
                    const subgraph_father_path = father.split("#")[0];
                    let ref_subgraph_father_label: string;
                    if (subgraph_father_path.includes("uplane/")) {
                        ref_subgraph_father_label = subgraph_father_path
                            .split("uplane/")
                            .pop()!;
                    } else {
                        ref_subgraph_father_label = subgraph_father_path;
                    }
                    this._dot_edge_subgraph += `subgraph "cluster_${subgraph_father_path}" {
                    style="rounded,dashed";
                    labelloc="t";
                    label="${ref_subgraph_father_label}";
                    "${dot_ref_father_name}"[label="${fatherLabel}"];
                    }\n`;
                }
            }
            // === 子函数子图 ===
            const subgraph_children_path = children.split("#")[0];
            let ref_subgraph_children_label: string;
            if (subgraph_children_path.includes("uplane/")) {
                ref_subgraph_children_label = subgraph_children_path
                    .split("uplane/")
                    .pop()!;
            } else {
                ref_subgraph_children_label = subgraph_children_path;
            }
            this._dot_edge_subgraph += `subgraph "cluster_${subgraph_children_path}" {
                    style="rounded,dashed";
                    labelloc="t";
                    label="${ref_subgraph_children_label}";
                    "${dot_ref_children_name}"[label="${childrenLabel}"];
                    }\n`;
            if (childrenRanges) {
                this._dot_edge += `{"${dot_ref_children_name}"[label="${childrenLabel}"]} -> {"${selectedTextWithUri}"[label="${selectTextLabel}"]}[color=black]\n`;
            }
        }

        // === 高亮 selectedText 函数节点 ===
        this._dot_edge_subgraph += `"${selectedTextWithUri}" [
        label="${selectTextLabel}";
        style="rounded,filled";
        color="black";
        fillcolor="#e4ffb5";
        fontname="Consolas"
        ]\n`;
    }

    toString() {
        let sub = "";
        // 返回最终拼接的 dot 内容
        return (
            this._dot + this._dot_edge + this._dot_edge_subgraph + sub + "}\n"
        );
    }
}
