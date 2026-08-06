import * as vscode from "vscode";
import { CallGraphEntry } from "./call_graph/entry";
import { Log } from "./util/logger";

export function activate(context: vscode.ExtensionContext) {
    Log.info("Synapse extension activated.");

    const manager = new CallGraphEntry(context);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "synapse.generateFuncCallGraph",
            () => manager.generateFuncCallGraph(),
        ),
        vscode.commands.registerCommand(
            "synapse.generateReferenceCallGraph",
            () => manager.generateReferenceCallGraph(),
        ),
        vscode.commands.registerCommand(
            "synapse.generateOutgoingTreeCallGraph",
            () => manager.generateFuncOutgoingTreeCallGraph(),
        ),
        vscode.commands.registerCommand(
            "synapse.generateFuncOutgoingCallGraph",
            () => manager.generateFuncOutgoingCallGraph(),
        ),
        vscode.commands.registerCommand("synapse.exportCallGraph", () => {
            const { CallGraphPanel } = require("./call_graph/webview");
            if (CallGraphPanel.currentPanel) {
                CallGraphPanel.currentPanel.postMessage({
                    command: "EVENT_EXPORT_SVG_TRIGGER",
                });
            }
        }),
        vscode.commands.registerCommand(
            "synapse.exportCallGraphToCsv",
            () => {
                const { CallGraphPanel } = require("./call_graph/webview");
                if (CallGraphPanel.currentPanel) {
                    CallGraphPanel.currentPanel.postMessage({
                        command: "EVENT_EXPORT_CSV_TRIGGER",
                    });
                }
            },
        ),
        vscode.commands.registerCommand("synapse.CallGraphToCopyFuc", () => {
            const { CallGraphPanel } = require("./call_graph/webview");
            if (CallGraphPanel.currentPanel) {
                CallGraphPanel.currentPanel.postMessage({
                    command: "EVENT_COPY_TRIGGER",
                });
            }
        }),
        vscode.commands.registerCommand(
            "synapse.CallGraphJumpToFunction",
            () => {
                const { CallGraphPanel } = require("./call_graph/webview");
                if (CallGraphPanel.currentPanel) {
                    CallGraphPanel.currentPanel.postMessage({
                        command: "EVENT_JUMP2CODE_TRIGGER",
                    });
                }
            },
        ),
        vscode.commands.registerCommand(
            "synapse.CallGraphToCopyFilePath",
            () => {
                const { CallGraphPanel } = require("./call_graph/webview");
                if (CallGraphPanel.currentPanel) {
                    CallGraphPanel.currentPanel.postMessage({
                        command: "EVENT_FILE_PATH_COPY_TRIGGER",
                    });
                }
            },
        ),
    );
}

export function deactivate() {
    Log.info("Synapse extension deactivated.");
}
