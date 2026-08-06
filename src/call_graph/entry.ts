import * as vscode from "vscode";
import * as generator from "./generator";
import { Log } from "../util/logger";
import { getDefaultProgressOptions } from "./utils/common";
/**
 * 命令管理器类，负责处理所有用户触发的命令逻辑
 */
/*
                   _ooOoo_
                  o8888888o
                  88" . "88
                  (| -_- |)
                  O\  =  /O
               ____/`---'\____
             .'  \\|     |//  `.
            /  \\|||  :  |||//  \
           /  _||||| -:- |||||-  \
           |   | \\\  -  /// |   |
           | \_|  ''\---/''  |   |
           \  .-\__  `-`  ___/-. /
         ___`. .'  /--.--\  `. . __
      ."" '<  `.___\_<|>_/___.'  >'"".
     | | :  `- \`.;`\ _ /`;.`/ - ` : | |
     \  \ `-.   \_ __\ /__ _/   .-` /  /
======`-.____`-.___\_____/___.-`____.-'======
                   `=---='
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
            佛祖保佑       永无BUG
*/
export class CallGraphEntry {
    protected context: vscode.ExtensionContext; // 扩展上下文对象

    /**
     * 构造函数
     * @param context 扩展上下文
     */
    public constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }
    /**
     * 生成函数级调用图的核心方法
     */
    public async generateFuncCallGraph(entry?: vscode.CallHierarchyItem[]) {
        Log.debug("Start to generate Func Call Graph...");
        vscode.window.withProgress(
            getDefaultProgressOptions("Generate Incoming Call Graph..."),
            generator.generateFuncIncomingGraph(this.context, entry),
        );
    }

    /**
     * * * 生成引用调用图的核心方法
     */
    public async generateReferenceCallGraph() {
        Log.debug("Start to generate Reference Call Graph...");

        vscode.window.withProgress(
            getDefaultProgressOptions("Generate Reference Graph..."),
            generator.generateReferenceGraph(this.context),
        );
    }
    public async generateFuncOutgoingTreeCallGraph(item?: any) {
        Log.debug("Start to generate Outgoing Call Tree...");
        vscode.window.withProgress(
            getDefaultProgressOptions("Generate Outgoing Call Tree..."),
            generator.generateFuncOutgoingTreeGraph(this.context, item),
        );
    }

    public async generateFuncOutgoingCallGraph() {
        Log.debug("Start to generate Outgoing Call Graph...");
        vscode.window.withProgress(
            getDefaultProgressOptions("Generate Outgoing Call Graph..."),
            generator.generateFuncOutgoingGraph(this.context),
        );
    }
    //在svg中点击生成函数外部调用图
    public async generateFuncOutgoingGraphInGraph(
        callHierarchyItems: vscode.CallHierarchyItem[],
    ) {
        Log.debug("Start to generate Outgoing Graph...");
        vscode.window.withProgress(
            getDefaultProgressOptions("Generate Outgoing Call Graph..."),
            generator.generateFuncOutgoingGraphInSvg(
                this.context,
                callHierarchyItems,
            ),
        );
    }
    /**
     * 这是方法  应对多个方法的引用调用图
     * @param overLimtMap
     */
    public async generateMultipleRefCallGraph(
        // overLimtMap: Map<string, DocumentSymbol[]>,
        title: string,
        ref_name: string,
    ) {
        Log.debug("Start to generate Multiple RefCallGraph...");
        vscode.window.withProgress(
            getDefaultProgressOptions("Generate Reference Graph for File..."),
            generator.generateMultipleRefCallGraph(
                this.context,
                // overLimtMap,
                title,
                ref_name,
            ),
        );
    }

    public async generateAllFilesCallGraph(
        // overLimtMap: Map<string, DocumentSymbol[]>,
        uri2RangesMap: Map<string, vscode.Range[]>,
        ref_name: string,
    ) {
        Log.debug("Start to generate All Files RefCallGraph...");
        vscode.window.withProgress(
            getDefaultProgressOptions(
                "Generate Reference Graph for All Files...",
            ),
            generator.generateAllFilesCallGraph(
                this.context,
                // overLimtMap,
                uri2RangesMap,
                ref_name,
            ),
        );
    }
}
