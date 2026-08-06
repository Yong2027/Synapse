import * as vscode from "vscode";
import { CallHierarchyNode } from "../node_graph";
import { Log } from "../../util/logger";
import { Range } from "vscode";
import { getRefGraph } from "../node_graph";
import { RefInformation } from "../interface";
import type {
    ClangdExtension,
    ASTParams,
    ASTNode,
} from "@clangd/vscode-clangd";

export const getDefaultProgressOptions = (
    title: string,
): vscode.ProgressOptions => {
    return {
        location: vscode.ProgressLocation.Notification,
        title: title,
        cancellable: true,
    };
};

function findLeafNodes(root: CallHierarchyNode): CallHierarchyNode[] {
    const leafNodes: CallHierarchyNode[] = [];

    function dfs(
        node: CallHierarchyNode,
        visited = new Set<CallHierarchyNode>(),
    ) {
        if (visited.has(node)) {
            return;
        }
        visited.add(node);

        if (node.father.length === 0) {
            leafNodes.push(node);
        } else {
            for (const child of node.father) {
                dfs(child, visited);
            }
        }
    }

    dfs(root);
    return leafNodes;
}
function printTrueChildrenTreeToCSV(
    node: CallHierarchyNode,
    depth: number,
    rows: string[][],
    verticals: boolean[] = [false],
    visited: Set<string>,
) {
    const row: string[] = [];

    // 构造缩进
    for (let i = 0; i < depth; i++) {
        row.push(verticals[i] ? "|" : "");
    }

    // 计算当前节点的唯一 id
    const line = node.item.range.start.line + 1;
    const fullPath = node.item.uri.path;
    const trimmedPath = fullPath.includes("/uplane/")
        ? fullPath.split("/uplane/")[1]
        : fullPath;
    const id = `${node.item.name}@${trimmedPath}:${line}`;

    // 标记并输出当前行
    const isRecursive = visited.has(id);
    row.push(
        `${node.item.name}()    @${trimmedPath}:${line}${
            isRecursive ? " [recursive]" : ""
        }`,
    );
    rows.push(row);

    // 如果是递归引用，直接返回，不再展开子节点
    if (isRecursive) {
        return;
    }

    // 标记已访问，准备展开子节点
    visited.add(id);

    // 拆分出递归子节点和普通子节点
    const children = node.children;
    const getId = (n: CallHierarchyNode) => {
        const l = n.item.range.start.line + 1;
        const fp = n.item.uri.path;
        const tp = fp.includes("/uplane/") ? fp.split("/uplane/")[1] : fp;
        return `${n.item.name}@${tp}:${l}`;
    };
    const recursiveChildren = children.filter((child) =>
        visited.has(getId(child)),
    );
    const normalChildren = children.filter(
        (child) => !visited.has(getId(child)),
    );

    // 先处理递归子节点，再处理其余子节点
    const ordered = [...recursiveChildren, ...normalChildren];
    const count = ordered.length;

    ordered.forEach((child, idx) => {
        const isLast = idx === count - 1;
        const nextVerticals = [...verticals, !isLast];
        printTrueChildrenTreeToCSV(
            child,
            depth + 1,
            rows,
            nextVerticals,
            visited,
        );
    });

    // 回溯：移除当前标记，保证兄弟分支可以正常展开
    visited.delete(id);
}

export function generateCallGraphCSV(graph: CallHierarchyNode): Uint8Array {
    const leafNodes = findLeafNodes(graph);
    const rows: string[][] = [];

    leafNodes.forEach((node, index) => {
        rows.push([`****** Entry Point ${index + 1} ******`]);
        const visited = new Set<string>();
        printTrueChildrenTreeToCSV(node, 0, rows, [false], visited);
    });

    const csvContent = rows.map((row) => row.join(",")).join("\n");
    return Buffer.from(csvContent, "utf8");
}

export function createDotHeader(title: string = ""): string {
    return (
        `digraph ${title} {\n` +
        "  graph [\n" +
        "    rankdir = LR\n" +
        "    ranksep = 1.4\n" + // 保持ranksep为1.4
        "    nodesep = 0.8\n" + // 保持nodesep为0.8
        '    bgcolor = "#f8f9fa"\n' +
        "  ]\n" +
        "  node [\n" +
        "    shape = box\n" +
        '    style = "rounded,filled"\n' +
        '    fillcolor = "#e9f2fb"\n' +
        '    color = "#0d6efd"\n' +
        '    fontname = "Consolas"\n' +
        '    fontcolor = "#212529"\n' +
        "  ]\n" +
        "  edge [\n" +
        '    color = "#00bcd4"\n' + // 保持边的颜色为#6c757d
        "    penwidth = 2.0\n" + // 边宽度设为2.0
        "    arrowsize = 0.8\n" +
        '    fontname = "Consolas"\n' +
        "  ]\n"
    );
}
import { DocumentSymbol } from "vscode";
/**
 * 从文档中提取指定行范围的文本，并去掉每行末尾多余的 '{'
 */
export function extractCodeText(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
): string {
    let codeText = "";

    if (startLine === endLine) {
        // 单行
        codeText = document.lineAt(startLine).text.trim();
        if (codeText.endsWith("{")) {
            codeText = codeText.slice(0, -1).trimEnd();
        }
    } else {
        // 多行
        for (let i = startLine; i <= endLine; i++) {
            let line = document.lineAt(i).text.trim();
            if (line.endsWith("{")) {
                line = line.slice(0, -1).trimEnd();
            }
            codeText += line + "\n";
        }
    }

    return codeText;
}

// 判断一个 range 是否完全包含在另一个 range 内
export function isRangeContained(
    outer: vscode.Range,
    inner: vscode.Range,
): boolean {
    return (
        outer.start.line <= inner.start.line && outer.end.line >= inner.end.line
    );
}

/**
 * 获取指定位置的引用单词信息
 * @param document 文档对象
 * @param position 光标位置
 * @returns 包含单词和 URI 的对象，或 null 如果没有找到单词
 */
export function getReferenceWordInfo(
    document: vscode.TextDocument,
    position: vscode.Position,
): { ref_word: string; ref_word_with_uri: string } | null {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
        Log.info("error getReferenceWordInfo");
        return null;
    }

    const ref_word = document.getText(wordRange);
    const ref_word_with_uri =
        document.uri.path +
        "#" +
        ref_word +
        "@" +
        wordRange.start.line +
        ":" +
        wordRange.start.character;

    return { ref_word, ref_word_with_uri };
}

/**
 * 获取引用位置对应的函数符号和范围  注意：可以处理多个引用位置/也可以处理单个引用位置
 * @param ref_locations 引用位置列表
 * @returns
 */
export async function getReferFuncWithRange(
    ref_locations: vscode.Location[],
): Promise<{
    ref_functions: DocumentSymbol[];
    ref_functions_map_range: Map<string, Range[]>;
}> {
    const ref_set: Set<string> = new Set();
    const ref_uri_functions_map: Map<string, DocumentSymbol[]> = new Map();
    const ref_functions_map_range: Map<string, Range[]> = new Map();
    const ref_functions: DocumentSymbol[] = [];

    for (let i = 0; i < ref_locations.length; i++) {
        const ref_location = ref_locations[i];
        const ref_uri = ref_location.uri.path;
        const ref_range: Range = ref_location.range;
        // === 如果尚未处理该文件，获取方法并缓存 ===
        if (!ref_set.has(ref_uri)) {
            await fetchAndCacheFunctionSymbols(
                ref_location.uri,
                ref_range,
                ref_set,
                ref_uri_functions_map,
            );
        } else {
            Log.info(`skip ${i} --- ${ref_uri}`);
        }
        const functions = ref_uri_functions_map.get(ref_uri);
        // Log.info(JSON.stringify(functions));
        if (functions) {
            for (const func of functions) {
                if (isRangeContained(func.range, ref_range)) {
                    // 排除 callback 和匿名函数
                    if (
                        func.name.includes("callback") ||
                        func.name.includes("<function>")
                    ) {
                        continue;
                    }
                    ref_functions.push(func);
                    //如果func.name包含::，则只取最后一个
                    if (func.name.includes("::")) {
                        func.name = func.name.split("::").pop()!;
                    }
                    let ref_functions_map_range_key = `${ref_uri}#${func.name}`;
                    if (
                        !ref_functions_map_range.has(
                            ref_functions_map_range_key,
                        )
                    ) {
                        ref_functions_map_range.set(
                            ref_functions_map_range_key,
                            [],
                        );
                    }
                    ref_functions_map_range
                        .get(ref_functions_map_range_key)!
                        .push(ref_range);
                }
            }
        }
    }
    return {
        ref_functions,
        ref_functions_map_range,
    };
}

export async function fetchAndCacheFunctionSymbols(
    uri: vscode.Uri,
    range: vscode.Range,
    ref_set: Set<string>,
    ref_uri_functions_map: Map<string, DocumentSymbol[]>,
): Promise<void> {
    const documentSymbols = await vscode.commands.executeCommand<
        DocumentSymbol[]
    >("vscode.executeDocumentSymbolProvider", uri);

    if (!documentSymbols) {
        Log.info(`documentSymbols is null for ${uri.path}`);
        return;
    }

    console.log(documentSymbols);

    const functions = await getUriFunctionSymbols(
        documentSymbols,
        5,
        range,
        [], // 初始为空
    );

    ref_set.add(uri.path);
    ref_uri_functions_map.set(uri.path, functions);
    Log.debug(`aliodfhasihfusoagfusd8gui`);
}

/**
 * 从一组 DocumentSymbol 中递归收集函数或方法符号
 * @param symbols 要遍历的符号列表
 * @param maxDepth 最大递归深度
 * @returns 收集到的函数/方法符号数组
 */
export async function getUriFunctionSymbols(
    symbols: DocumentSymbol[],
    maxDepth = 5,
    ref_range: Range,
    result: DocumentSymbol[],
    depth = 0,
): Promise<DocumentSymbol[]> {
    if (symbols.length === 0) {
        return Promise.resolve(result);
    }
    if (depth > maxDepth) {
        return Promise.resolve(result);
    }
    for (const symbol of symbols) {
        if (
            symbol.kind === vscode.SymbolKind.Function ||
            symbol.kind === vscode.SymbolKind.Method
        ) {
            // const funcRange = symbol.range;
            // if (isRangeContained(funcRange, ref_range)) {
            result.push(symbol);
            // }
        }
        if (symbol.children?.length) {
            getUriFunctionSymbols(
                symbol.children,
                maxDepth,
                ref_range,
                result,
                depth + 1,
            );
        }
    }
    return result;
}

/**
 * 将调用信息字符串解析为 vscode.Location[]（包含 Range 和 Uri）
 * 例如处理："1.line 10:0-12:5" 这类格式
 * @param ref 文件 URI
 * @param calls 调用信息行（如 title 中包含的多行字符串）
 * @returns vscode.Location[] 数组
 */
export function parseCallLocations(
    ref: vscode.Uri,
    calls: string[],
): vscode.Location[] {
    const locations: vscode.Location[] = [];

    for (const call of calls) {
        const match = call.match(/\d*\.?line (\d+):(\d+)~(\d+):(\d+)/);
        if (!match) {continue;}

        const [_, sl, sc, el, ec] = match.map(Number);
        if ([sl, sc, el, ec].some(Number.isNaN)) {continue;}

        const range = new vscode.Range(
            new vscode.Position(sl, sc),
            new vscode.Position(el, ec),
        );
        locations.push(new vscode.Location(ref, range));
    }

    return locations;
}

export function parseUri2RangesMapToLocations(
    uri2RangesMap: Map<string, vscode.Range[]>,
): vscode.Location[] {
    const locations: vscode.Location[] = [];

    for (const [uriStr, ranges] of uri2RangesMap.entries()) {
        const uri = vscode.Uri.parse(uriStr);

        for (const range of ranges) {
            locations.push(new vscode.Location(uri, range));
        }
    }

    return locations;
}

/**
 *
 * @funcname refFunctions
 * @param nodeMap
 * @param processedMap
 */
export async function processRefFunctions(
    refFunctions: DocumentSymbol[], // 原类型不一定是 RefInformation[]
    nodeMap: Map<string, Set<string>>,
    processedMap: Map<string, string>,
): Promise<void> {
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(5); // 控制最多5个并发

    const tasks = refFunctions.map((func) =>
        limit(async () => {
            const ref_func_info = func as RefInformation; // 保留你的强转
            if (!ref_func_info) {
                return;
            }

            try {
                const uri = ref_func_info.location.uri;
                const funcRange = ref_func_info.selectionRange;
                const position = funcRange.start;

                Log.info("==== Processing processRefFunctions  ====");

                const entry: vscode.CallHierarchyItem[] =
                    await vscode.commands.executeCommand(
                        "vscode.prepareCallHierarchy",
                        uri,
                        position,
                    );

                if (!entry || !entry[0]) {return;}

                await getRefGraph(entry[0], nodeMap, processedMap);
            } catch (err) {
                Log.error(`Error preparing call hierarchy: ${err}`);
            }
        }),
    );

    await Promise.all(tasks);
}
// 暂放此处，供reference中的统计read，write，reference使用
export function findFirstSymbolFromEnd(
    str: string,
    symbols: string[],
): string | null {
    let maxIdx = -1;
    let foundSymbol: string | null = null;
    for (const character of symbols) {
        const idx = str.lastIndexOf(character);
        if (idx > maxIdx) {
            // 特殊处理&
            if (character === "&" && idx > 0 && str[idx - 1] === "&") {
                maxIdx = idx;
                foundSymbol = "other";
            } else {
                maxIdx = idx;
                foundSymbol = character;
            }
        }
    }
    return foundSymbol;
}
/**
 * 从当前位置遍历到结束，遇到赋值运算符优先返回 true，否则遇到分号/大括号或结束返回 false
 */
export function findFirstSymbolFromBeginning(
    str: string,
    startIdx: number = 0,
): boolean {
    //用来记录之前是否判断过空格
    let flag = false;
    // 赋值运算符集合，长的优先
    // 读的符号组（按优先级先判断）
    const readOps = ["==", "!=", "<=", ">=", "&&", "||", "->"];
    const assignOps = [
        "<<=",
        ">>=",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "&=",
        "|=",
        "^=",
        "=",
    ];
    const stopSymbols = [";", "{", "}"];
    let i = startIdx;

    // 跳过变量名（字母、数字、下划线）和空白字符
    while (i < str.length && (/\w/.test(str[i]) || /\s/.test(str[i]))) {
        i++;
    }

    while (i < str.length) {
        // 检查赋值运算符

        // 1. 先判断读的符号组：如果命中，则认为后续是读，返回 false -- modify by Yong 2025/12/30
        for (const op of readOps) {
            if (str.startsWith(op, i)) {
                return false; // 读
            }
        }

        // 2. 再判断赋值运算符
        for (const op of assignOps) {
            if (str.startsWith(op, i)) {
                return true;
            }
        }
        // 检查停止符号
        if (stopSymbols.includes(str[i])) {
            return false;
        }
        i++;
    }
    return false;
}
// // 判断目标范围 targetRange 是否被某个 AST 节点 node（及其所有子节点）包含
// function rangeContainsNode(node: ASTNode, targetRange: vscode.Range): boolean {
//     if (!node.range) return false;
//     const nodeRange = new vscode.Range(
//         node.range.start.line,
//         node.range.start.character,
//         node.range.end.line,
//         node.range.end.character,
//     );
//     if (nodeRange.intersection(targetRange)) {
//         if (node.children) {
//             for (const child of node.children) {
//                 if (rangeContainsNode(child, targetRange)) {
//                     return true;
//                 }
//             }
//         }
//         return true;
//     }
//     return false;
// }

// // 统计分析 read, write, reference
// function analyzeASTNode(
//     node: ASTNode,
//     counts: { readCount: number; writeCount: number; referenceCount: number },
//     targetRange: vscode.Range,
//     targetSymbol: string, // 增加目标符号名参数
//     depth = 0,
//     doc?: vscode.TextDocument,
//     parentKind?: string, // 增加父节点类型参数
//     parentNode?: ASTNode, // 补充父节点
// ) {
//     if (!node || !doc) return;
//     if (!node.range && node.children) {
//         for (const child of node.children) {
//             (child as any).parent = node;
//             analyzeASTNode(
//                 child,
//                 counts,
//                 targetRange,
//                 targetSymbol,
//                 depth + 1,
//                 doc,
//                 node.kind,
//                 node,
//             );
//         }
//         return;
//     }
//     if (!node.range) return;
//     let nodeRange = new vscode.Range(
//         node.range.start.line,
//         node.range.start.character,
//         node.range.end.line,
//         node.range.end.character,
//     );
//     let codeText = doc.getText(nodeRange);
//     const indent = " ".repeat(depth * 2);
//     const detailIndex = codeText.indexOf(node.detail ?? "");
//     const start = nodeRange.start.translate(0, detailIndex);
//     const end = start.translate(0, node.detail?.length || 0);
//     const detailRange = new vscode.Range(start, end);

//     // 限制 node.range的范围在targetRange内，如果两个range没有交集则不会进一步分析后续代码
//     const intersects = nodeRange.intersection(targetRange);
//     if (intersects) {
//         if (
//             node.detail === targetSymbol &&
//             targetRange.start.character === detailRange.start.character &&
//             targetRange.end.character === detailRange.end.character
//         ) {
//             // 递归时才严格判断
//             // 递归向上查找最近的赋值操作祖先节点
//             let assignAncestor = parentNode;
//             // 赋值运算符集合,限制 BinaryOperator 的 detai 只为赋值运算符
//             const ASSIGN_OPERATORS = new Set([
//                 "=",
//                 "+=",
//                 "-=",
//                 "*=",
//                 "/=",
//                 "%=",
//                 "&=",
//                 "|=",
//                 "^=",
//                 "<<=",
//                 ">>=",
//             ]);

//             while (
//                 assignAncestor &&
//                 !(
//                     (assignAncestor.kind === "BinaryOperator" &&
//                         ASSIGN_OPERATORS.has(assignAncestor.detail ?? "")) ||
//                     assignAncestor.kind === "CompoundAssignOperator"
//                 )
//             ) {
//                 assignAncestor = (assignAncestor as any).parent;
//             }
//             if (
//                 assignAncestor &&
//                 assignAncestor.children &&
//                 ((assignAncestor.kind === "BinaryOperator" &&
//                     ASSIGN_OPERATORS.has(assignAncestor.detail ?? "")) ||
//                     assignAncestor.kind === "CompoundAssignOperator")
//             ) {
//                 if (rangeContainsNode(assignAncestor.children[0], nodeRange)) {
//                     counts.writeCount++;
//                 } else {
//                     counts.readCount++;
//                 }
//             } else if (
//                 parentKind === "UnaryOperator" &&
//                 parentNode?.detail === "&"
//             ) {
//                 counts.referenceCount++;
//             } else {
//                 counts.readCount++;
//             }
//         }
//     }
//     if (node.children) {
//         for (const child of node.children) {
//             (child as any).parent = node;
//             analyzeASTNode(
//                 child,
//                 counts,
//                 targetRange,
//                 targetSymbol,
//                 depth + 1,
//                 doc,
//                 node.kind,
//                 node,
//             );
//         }
//     }
// }

// // 通用 AST 统计函数
// export async function analyzeRangesByAST(
//     uri: string,
//     ranges: vscode.Range[],
//     selected_text: string,
// ): Promise<{ readCount: number; writeCount: number; referenceCount: number }> {
//     const CLANGD_EXTENSION = "llvm-vs-code-extensions.vscode-clangd";
//     const CLANGD_API_VERSION = 1;
//     const ASTRequestMethod = "textDocument/ast";
//     const clangdExtension =
//         vscode.extensions.getExtension<ClangdExtension>(CLANGD_EXTENSION);
//     if (!clangdExtension) {
//         Log.error("Clangd extension not found");
//         return { readCount: 0, writeCount: 0, referenceCount: 0 };
//     }
//     const api = (await clangdExtension.activate()).getApi(CLANGD_API_VERSION);
//     if (!api.languageClient) {
//         Log.error("Clangd language client not ready");
//         return { readCount: 0, writeCount: 0, referenceCount: 0 };
//     }
//     const counts = { readCount: 0, writeCount: 0, referenceCount: 0 };
//     const startAll = Date.now();
//     for (let index = 0; index < ranges.length; index++) {
//         const range = ranges[index];
//         try {
//             const startDoc = Date.now();
//             const doc = await vscode.workspace.openTextDocument(
//                 vscode.Uri.parse(uri),
//             );
//             Log.info(`[AST] 打开文档耗时: ${Date.now() - startDoc} ms`);
//             const line = doc.lineAt(range.start.line);
//             const fullLineRange = new vscode.Range(
//                 line.range.start,
//                 line.range.end,
//             );
//             const textDocument =
//                 api.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(
//                     doc,
//                 );
//             const lspRange =
//                 api.languageClient.code2ProtocolConverter.asRange(
//                     fullLineRange,
//                 );
//             const startAst = Date.now();
//             const params: ASTParams = { textDocument, range: lspRange };
//             const ast: ASTNode | undefined =
//                 await api.languageClient.sendRequest(ASTRequestMethod, params);
//             Log.info(`[AST] 获取AST耗时: ${Date.now() - startAst} ms`);
//             const startAnalyze = Date.now();
//             if (ast) {
//                 const prevRead = counts.readCount;
//                 const prevWrite = counts.writeCount;
//                 const prevRef = counts.referenceCount;
//                 analyzeASTNode(
//                     ast,
//                     counts,
//                     range,
//                     selected_text,
//                     0,
//                     doc,
//                     undefined,
//                     ast,
//                 );
//                 if (
//                     counts.readCount === prevRead &&
//                     counts.writeCount === prevWrite &&
//                     counts.referenceCount === prevRef
//                 ) {
//                     counts.readCount++;
//                 }
//             } else {
//                 counts.readCount++;
//             }
//             Log.info(`[AST] analyzeASTNode耗时: ${Date.now() - startAnalyze} ms`);
//         } catch (error) {
//             Log.error(`Failed to get AST for ${uri}: ${error}`);
//             counts.readCount++;
//         }
//     }
//     Log.info(`[AST] analyzeRangesByAST总耗时: ${Date.now() - startAll} ms`);
//     return counts;
// }
