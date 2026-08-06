import * as vscode from "vscode";
import { Range } from "vscode";
import { DocumentSymbol } from "vscode";
import { ReferGraph, ReferOverLimitGraph } from "./refer_graph";
import { ReferMultipleGraph } from "./refer_graph";

export async function generateReferDot(
    ref_functions_map_range: Map<string, Range[]>,
    ref_callGraphs: Map<string, Set<string>>,
    selectedText: string,
    selected_text_uri: string,
): Promise<{
    dotRefGraph: ReferGraph;
}> {
    const dotRefGraph = new ReferGraph();
    await dotRefGraph.addNode(
        selectedText,
        ref_callGraphs,
        ref_functions_map_range,
        selected_text_uri,
    );

    return {
        dotRefGraph,
    };
}

export async function generateReferOverLimitDot(
    uri2RangesMap: Map<string, vscode.Range[]>,
    selectedText: string,
    selected_text_uri: string,
): Promise<{
    dotRefOverLimitGraph: ReferOverLimitGraph;
}> {
    const dotRefOverLimitGraph = new ReferOverLimitGraph();
    await dotRefOverLimitGraph.addNode(
        uri2RangesMap,
        selectedText,
        selected_text_uri,
    );

    return {
        dotRefOverLimitGraph,
    };
}

export async function generateMultipleReferDot(
    nodeMap: Map<string, Set<string>>,
    ref_name: string,
    func_ref_uri_map: Map<string, Range[]>,
): Promise<{
    dot: ReferMultipleGraph;
}> {
    const dot = new ReferMultipleGraph();
    await dot.addNode(nodeMap, ref_name, func_ref_uri_map);
    return { dot };
}
