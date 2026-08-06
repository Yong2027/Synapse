(function () {
    // const vscode = acquireVsCodeApi();
    const graph = document.querySelector("svg");
    this.title = "";
    this.highlightedNodeText = ""; // 保存当前高亮的节点

    let matchedNodes = []; // 用于存储所有匹配到的g.node
    let currentSearchIndex = -1; // 当前导航到的搜索结果索引
    // let lastKeyword = "";

    // 保存当前需要重新高亮的节点信息
    let pendingHighlightNode = null;

    // 生成当前SVG实例的唯一标识符
    function generateSVGInstanceId() {
        const svg = document.querySelector("svg");
        if (!svg) return "default";

        // 使用SVG内容的哈希值和页面标题作为唯一标识
        const svgContent = svg.outerHTML;
        const pageTitle = document.title;

        // 简单的字符串哈希函数
        function simpleHash(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // 转换为32位整数
            }
            return Math.abs(hash).toString(36);
        }

        return `${simpleHash(pageTitle)}_${simpleHash(svgContent.substring(0, 1000))}`;
    }

    // 获取当前实例的localStorage键名
    const svgInstanceId = generateSVGInstanceId();
    const STORAGE_KEYS = {
        keyword: `synapse-search-keyword-${svgInstanceId}`,
        matchedIndexes: `synapse-search-matched-indexes-${svgInstanceId}`,
        currentIndex: `synapse-search-current-index-${svgInstanceId}`
    };


    document.addEventListener('DOMContentLoaded', () => {
        const input = document.getElementById('incoming-level-input');
        const applyBtn = document.getElementById('apply-incoming-level');

        if (!input || !applyBtn) return; // 非 income 图则跳过

        // 监听输入：只允许数字，且标记用户已输入
        input.addEventListener('input', () => {
            const val = input.value.trim();
            if (val === '') return;

            const num = parseInt(val, 10);
            if (num < 4 || num > 32) {
                input.setCustomValidity('Level must be between 4 and 32!');
                input.style.color = '#d00'; //变红提示
            } else {
                input.setCustomValidity('');
                input.style.color = ''; // 恢复默认
            }
        });

        // Apply 按钮点击
        applyBtn.addEventListener('click', () => {
            const raw = input.value.trim();
            const num = parseInt(raw, 10);
            // 发消息给 VS Code 扩展
            window.vscode.postMessage({
                command: 'EVENT_APPLY_INCOMING_LEVEL',
                level: levelToSend,
                keyword: STORAGE_KEYS.keyword
            });

        });
    });



    // 初始化 panzoom 实例
    const panZoomInstance = panzoom(graph, {
        minZoom: 1,
        smoothScroll: false,
        zoomDoubleClickSpeed: 1,
    });

    // ===== 尝试恢复上次的 transform 状态 =====
    const savedState = vscode.getState();
    if (savedState?.transform) {
        const { x, y, scale } = savedState.transform;
        panZoomInstance.zoomAbs(0, 0, scale); // 正确缩放（以左上角为中心）
        panZoomInstance.moveTo(x, y); // 正确定位
    }

    // ===== 在每次用户拖动/缩放时保存 transform 状态 =====
    panZoomInstance.on("transform", () => {
        const transform = panZoomInstance.getTransform();
        vscode.setState({ transform });
    });
    // 在 DOMContentLoaded 或立即调用
    // 只在 Reference Graph 中添加水印
    const graphType = document.querySelector("body");
    const skipThisFile = document.querySelector('[data-action="EVENT_REF_CALL_GRAPH"]');
    const skipAllFiles = document.querySelector('[data-action="EVENT_REF_CALL_GRAPH_ALL_FILES"]');
    if (graphType?.getAttribute("data-graph-type") === "reference" && skipThisFile && skipAllFiles) {
        addWatermark();
    }
    let mouseDownPos = null;
    //获取鼠标点击左键时的位置
    graph?.addEventListener("mousedown", (event) => {
        //判断鼠标左键
        if (event.button === 0) {
            mouseDownPos = { x: event.clientX, y: event.clientY };
        }
    });

    //鼠标左键点击事件 获取svg中的g.node或者g.cluster的节点 左键点击事件
    /**
            <g id="clust34" class="cluster">
            <title>cluster_/c:/nokia/dev/wall&#45;e/src/testcase/check_includes/unit.test.ts</title>
            <path fill="#f8f9fa" stroke="black" stroke-dasharray="5,2" d="M667.33,-8C667.33,-8 878.6,-8 878.6,-8 884.6,-8 890.6,-14 890.6,-20 890.6,-20 890.6,-73 890.6,-73 890.6,-79 884.6,-85 878.6,-85 878.6,-85 667.33,-85 667.33,-85 661.33,-85 655.33,-79 655.33,-73 655.33,-73 655.33,-20 655.33,-20 655.33,-14 661.33,-8 667.33,-8"/>
            <text text-anchor="middle" x="772.96" y="-68.4" font-family="Times,serif" font-size="14.00">/src/testcase/check_includes/unit.test.ts</text>
            </g>
     */
    let lastClickedNode = null;
    function clearNodeHighlight(node) {
        if (!node) return;
        node.classList.remove("active-node");
        ["path", "polygon"].forEach(tag => {
            const shape = node.querySelector(tag);
            if (shape?.hasAttribute("data-original-fill") &&
                shape.getAttribute("fill") === "#0d6efd") {
                shape.setAttribute("fill", shape.getAttribute("data-original-fill"));
            }
        });
    }

    graph?.addEventListener("click", (event) => {
        // 判断是否为拖拽（移动距离超过阈值则不处理为点击）
        if (mouseDownPos) {
            const dx = Math.abs(event.clientX - mouseDownPos.x);
            const dy = Math.abs(event.clientY - mouseDownPos.y);
            if (dx > 0 || dy > 0) return; // 阈值可调整
        }
        mouseDownPos = null;
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const ctrlKey = isMac ? event.metaKey : event.ctrlKey;

        // 检查是否点击了圆圈   高亮点击节点颜色 9/4号新增-----------------------------------
        const circleGroup = event.target.closest('.plus-circle, .minus-circle');
        if (circleGroup && circleGroup.dataset.node) {
            // 保存点击的节点信息，用于展开后重新高亮
            const clickedNodeName = circleGroup.dataset.node;
            // console.log(`点击了展开/收缩按钮，节点: ${clickedNodeName}`);
            this.title = clickedNodeName;

            // 保存待高亮的节点信息
            pendingHighlightNode = clickedNodeName;

            // 先恢复所有节点颜色
            const svg = document.querySelector("svg");
            if (svg) {
                svg.querySelectorAll("g.node").forEach(g => {
                    ["path", "polygon"].forEach(tag => {
                        const shape = g.querySelector(tag);
                        if (shape && shape.hasAttribute("data-original-fill")) {
                            const orig = shape.getAttribute("data-original-fill");
                            shape.setAttribute("fill", orig);
                        }
                    });
                    g.classList.remove("active-node");
                });
            }

            // 发送展开节点消息，同时传递搜索关键词键名
            vscode.postMessage({
                command: 'EVENT_EXPAND_NODE',
                data: clickedNodeName,
                keyword: STORAGE_KEYS.keyword  // 传递搜索关键词键名而不是值
            });
            // 等待后端处理完毕后再输出
            // 不继续执行后续的点击处理逻辑
            return;
        }
        // 9/4新增---------

        // 恢复所有节点的颜色----------------
        const targetNode = event.target.closest("g.node");

        const graphType = document.body?.dataset.graphType || null;

        if (targetNode) {
            const textEl = targetNode.querySelector("text");
            if (textEl) {
                this.highlightedNodeText = textEl.textContent || "";
            }
            const titleElement = targetNode.querySelector("title");
            this.title = titleElement
                ? titleElement.textContent
                : "No title found";
            if (ctrlKey && event.button === 0) {
                vscode.postMessage({
                    command: "EVENT_CLICK",
                    data: this.title,
                });
                // 注意：这里不做任何高亮/取消操作，保留 lastClickedNode
            } else if (event.button === 0) {// 普通左键：需要处理高亮切换
                // 如果之前有高亮，且不是当前节点，则取消旧高亮
                if (lastClickedNode && lastClickedNode !== targetNode) {
                    clearNodeHighlight(lastClickedNode);
                }
                // 高亮当前节点
                targetNode.classList.add("active-node");
                ["path", "polygon"].forEach(tag => {
                    const shape = targetNode.querySelector(tag);
                    if (shape) {
                        if (!shape.hasAttribute("data-original-fill")) {
                            shape.setAttribute("data-original-fill", shape.getAttribute("fill") || "");
                        }
                    }
                });
                lastClickedNode = targetNode;
                highlightCallGraphEdges();

                vscode.postMessage({
                    command: "EVENT_HIGHLIGHT",
                });
            }
        } else {
            // 点击空白
            if (lastClickedNode) {
                clearNodeHighlight(lastClickedNode);
                lastClickedNode = null;
            }
            // 清除所有 active-node
            graph.querySelectorAll("g.node.active-node").forEach(n => n.classList.remove("active-node"));
            clearCallGraphHighlight();
        }
    });
    //右键菜单事件
    graph?.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const targetNode = event.target.closest("g.node, g.cluster");
        const nodeMenu = document.getElementById("context-menu-node");
        const nodeMenuRefFirst = document.getElementById(
            "context-menu-node-ref-first",
        );
        const clusterMenu = document.getElementById("context-menu-cluster");
        const blankMenu = document.getElementById("context-menu-blank");

        // 先全部隐藏
        nodeMenu.style.display = "none";
        nodeMenuRefFirst.style.display = "none";
        clusterMenu.style.display = "none";
        blankMenu.style.display = "none";

        graph.querySelectorAll(".highlighted-node").forEach((n) => {
            n.classList.remove("highlighted-node");
        });
        graph.querySelectorAll("text").forEach((text) => {
            text.setAttribute("font-weight", "normal");
        });

        if (targetNode) {
            const isCluster = targetNode.classList.contains("cluster");

            // 是节点或 cluster，高亮
            targetNode.classList.add("highlighted-node");

            const textEl = targetNode.querySelector("text");
            if (textEl) {
                textEl.setAttribute("font-weight", "bold");
                this.highlightedNodeText = textEl.textContent || "";

                const titleElement = targetNode.querySelector("title");
                this.title = titleElement
                    ? cleanNodeName(titleElement.textContent)
                    : "No title found";
                // ✅ 如果节点 title 与 <title> 内容一致，退出右键菜单处理
                if (this.title === cleanNodeName(document.title)) {
                    return; // 相同就跳过不展示任何菜单
                }
            }
            //之前是const menu = isCluster ? clusterMenu : nodeMenu;
            // 现在多了一种情况：如果 this.title 包含 ()，使用 nodeMenuRefFirst
            let menu;
            if (isCluster) {
                menu = clusterMenu;
            } else if (this.title.includes("line")) {
                menu = nodeMenuRefFirst;
            } else {
                menu = nodeMenu;
            }

            menu.style.left = `${event.pageX}px`;
            menu.style.top = `${event.pageY}px`;
            menu.style.display = "block";
            menu.dataset.nodeId = targetNode.id || "";
        } else {
            // 空白区域，显示空白菜单
            blankMenu.style.left = `${event.pageX}px`;
            blankMenu.style.top = `${event.pageY}px`;
            blankMenu.style.display = "block";
        }
    });


    //右键菜单的菜单选择点击事件
    document.querySelectorAll(".menu-item").forEach((item) => {
        item.addEventListener("click", () => {
            const action = item.dataset.action;
            const nodeId =
                item.closest("#context-menu-node")?.dataset.nodeId || null;
            // 本地处理不同菜单项动作
            switch (action) {
                case "EVENT_COPY":
                    nodeInfoCopy();
                    break;
                case "EVENT_JUMP2CODE":
                    jumpToFunction();
                    break;
                case "EVENT_EXPORT_CSV":
                    exportCSV();
                    break;
                case "EVENT_EXPORT_SVG":
                    exportSVG();
                    break;
                case "EVENT_COPY_FILE_PATH":
                    nodeInfoCopy();
                    break;
                case "EVENT_CALL_FUNC_GRAPH":
                    refNodeCallGraph();
                    break;
                case "EVENT_REF_CALL_GRAPH":
                    refMultipleCallGraph();
                    break;
                case "EVENT_REF_CALL_GRAPH_ALL_FILES":
                    allfilesCallGraph();
                    break;
                case "EVENT_FEATURE_DEEPDIVE_ANALYSIS":
                    generateFeatureFileAnalysisResult("menu");
                case "EVENT_OUTGOING_CALL_GRAPH":
                    outgoingCallGraph();
                    break;
                default:
                    console.warn("Unknown menu action:", action);
            }

            // 隐藏两个菜单
            document.getElementById("context-menu-node").style.display = "none";
            document.getElementById("context-menu-blank").style.display =
                "none";
            document.getElementById("context-menu-cluster").style.display =
                "none";
            document.getElementById(
                "context-menu-node-ref-first",
            ).style.display = "none";
        });
    });

    // 为视图切换菜单项添加事件监听器
    const blankMenu = document.getElementById("context-menu-blank");
    if (blankMenu) {
        blankMenu.addEventListener("click", (e) => {
            const target = e.target.closest(".menu-item");
            if (target) {
                const text = target.textContent.trim();
                if (text === "Switch To Simple View") {
                    vscode.postMessage({
                        command: "EVENT_SWITCH_GRAPH_VIEW",
                        graphType: 0
                    });
                } else if (text === "Switch To Full View") {
                    vscode.postMessage({
                        command: "EVENT_SWITCH_GRAPH_VIEW",
                        graphType: 1
                    });
                }
            }
        });
    }

    // 在整个 body 上添加视图切换功能
    const bodyElement = document.querySelector("body");
    let ctrlPressed = false;
    // 点击任意区域，隐藏两个菜单
    document.addEventListener("click", () => {
        document.getElementById("context-menu-node").style.display = "none";
        document.getElementById("context-menu-node-ref-first").style.display =
            "none";
        document.getElementById("context-menu-blank").style.display = "none";
        document.getElementById("context-menu-cluster").style.display = "none";
    });

    // 在整个body区域添加点击事件，实现重置功能  body清除高亮
    document.body?.addEventListener("click", (event) => {
        // 检查点击的是否为SVG内的节点
        const targetNode = event.target.closest("g.node");
        // 检查点击的是否为SVG区域
        const targetSVG = event.target.closest("svg");

        // 如果点击的不是节点，并且不是SVG内的其他元素，则执行重置
        if (!targetNode && !targetSVG) {
            // 移除所有节点的active-node类
            graph?.querySelectorAll("g.node.active-node").forEach(g => g.classList.remove("active-node"));

            // 恢复所有节点颜色
            graph?.querySelectorAll("g.node").forEach(g => {
                ["path", "polygon"].forEach(tag => {
                    const shape = g.querySelector(tag);
                    if (shape && shape.hasAttribute("data-original-fill")) {
                        // 只恢复深蓝色高亮（#0d6efd），不恢复橙色
                        if (shape.getAttribute("fill") === "#0d6efd") {
                            const orig = shape.getAttribute("data-original-fill");
                            shape.setAttribute("fill", orig);
                        }
                    }
                });
            });

            // 清除高亮
            if (typeof clearCallGraphHighlight === 'function') {
                clearCallGraphHighlight();
            }
        }
    });
    //body 清除高亮



    //键盘按键事件
    //键盘按键事件
    document.addEventListener("keydown", (event) => {
        // console.log("触发了keydown事件");
        //判断当前运行环境是不是 Mac 操作系统
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        //如 Mac 用 metaKey，Windows/Linux 用 ctrlKey
        const ctrlKey = isMac ? event.metaKey : event.ctrlKey;


        if (ctrlKey && !ctrlPressed) {
            ctrlPressed = true;

            const { x, y } = window._lastMousePos || { x: 0, y: 0 };
            window._lastMousePos = { x, y };
            updateCursor();
        }


        if (ctrlKey && event.key === "c") {
            if (this.highlightedNodeText) {
                event.preventDefault(); // 防止浏览器默认复制
                nodeInfoCopy();

                // ✅ 关闭所有菜单
                document.getElementById("context-menu-node").style.display =
                    "none";
                document.getElementById("context-menu-blank").style.display =
                    "none";
                document.getElementById("context-menu-cluster").style.display =
                    "none";
                document.getElementById(
                    "context-menu-node-ref-first",
                ).style.display = "none";
            }
        }
    });
    document.addEventListener("keyup", (e) => {
        // console.log("触发了keyup事件");
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        if ((isMac && !e.metaKey) || (!isMac && !e.ctrlKey)) {
            if (ctrlPressed) {
                ctrlPressed = false;
                updateCursor(); // 更新鼠标样式
            }
        }
    });
    graph.setAttribute('tabindex', '0'); // 必须可聚焦
    graph.addEventListener('mouseenter', () => {
        // 只有当前没有聚焦在输入框时才让 SVG 获得焦点
        const active = document.activeElement;
        const searchBox = document.getElementById("searchBox");
        if (active !== searchBox) {
            graph.focus();
        }

    });
    // 鼠标移动时动态设置节点的鼠标样式
    // 记录鼠标位置
    window._lastMousePos = { x: 0, y: 0 };
    graph?.addEventListener("mousemove", (event) => {
        // 自动模拟点击 SVG 的 (0,0) 位置

        // console.log("触发了mousemove事件");
        //graph.focus();

        window._lastMousePos = { x: event.clientX, y: event.clientY };

        // 🔑 直接根据 event.ctrlKey / event.metaKey 判断当前键盘状态
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const realCtrl = isMac ? event.metaKey : event.ctrlKey;
        if (ctrlPressed !== realCtrl) {
            ctrlPressed = realCtrl;
            updateCursor(); // 立即刷新光标
        }
        const targetNode = event.target.closest("g.node");
        if (targetNode) {
            graph.style.cursor = ctrlPressed ? "pointer" : "default";
        } else {
            graph.style.cursor = "default";
        }
    });

    window.addEventListener("focus", () => {

        // console.log("触发了focus事件");
        // 1. 切换回窗口时，直接重置 ctrlPressed 状态（不依赖 window.event）
        ctrlPressed = false;
        // 2. 立即刷新鼠标样式
        updateCursor();
        // 3. 如果鼠标位置在 svg 上，主动触发一次 mousemove 事件，确保样式刷新
        if (window._lastMousePos && graph) {
            const evt = new MouseEvent("mousemove", {
                clientX: window._lastMousePos.x,
                clientY: window._lastMousePos.y,
                bubbles: true,
                cancelable: true,
                view: window
            });
            graph.dispatchEvent(evt);

        }
    });


    // 阻止输入框和按钮上的鼠标事件冒泡到SVG，避免拖动冲突
    ["searchBox", "searchBtn", "resetBtn", "search-up-btn", "search-down-btn"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            ["mousedown", "mousemove", "mouseup", "click"].forEach(mouseEvent => {
                el.addEventListener(mouseEvent, function (e) {
                    e.stopPropagation();
                });
            });
        }
    });
    const btn = document.getElementById("searchBtn");
    const resetBtn = document.getElementById("resetBtn");
    const upBtn = document.getElementById("search-up-btn");
    const downBtn = document.getElementById("search-down-btn");
    const input = document.getElementById("searchBox");
    let nodesHighlighted = false; // 用于跟踪节点是否已高亮

    // 导航按钮事件
    if (upBtn) {
        upBtn.addEventListener("click", searchUp);
    }
    if (downBtn) {
        downBtn.addEventListener("click", searchDown);
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", function () {
            vscode.postMessage({
                command: "EVENT_RESET",
            });
            // 清空 searchBox 文本框内容
            if (input) {
                input.value = "";
            }
            // 清空当前SVG实例的localStorage
            window.localStorage.removeItem(STORAGE_KEYS.keyword);
            window.localStorage.removeItem(STORAGE_KEYS.matchedIndexes);
            window.localStorage.removeItem(STORAGE_KEYS.currentIndex);
            // 隐藏搜索结果计数和上下按钮
            const resultCountEl = document.getElementById("search-result-count");
            if (resultCountEl) resultCountEl.style.display = "none";
            if (upBtn) upBtn.style.display = "none";
            if (downBtn) downBtn.style.display = "none";
            const svg = document.querySelector("svg");
            if (!svg) { return; }
            svg.querySelectorAll("g.node").forEach(g => {
                ["path", "polygon"].forEach(tag => {
                    const shape = g.querySelector(tag);
                    if (shape && shape.hasAttribute("data-original-fill")) {
                        const orig = shape.getAttribute("data-original-fill");
                        shape.setAttribute("fill", orig);
                    }
                });
            });
            // 恢复子图标题的高亮背景颜色
            svg.querySelectorAll("g.cluster").forEach(g => {
                ["path"].forEach(tag => {
                    const shape = g.querySelector(tag);
                    if (shape && shape.hasAttribute("data-original-fill")) {
                        const orig = shape.getAttribute("data-original-fill");
                        shape.setAttribute("fill", orig);
                    }
                });
                // 移除所有cluster文本背景
                const oldBgs = g.querySelectorAll("rect.cluster-text-bg");
                oldBgs.forEach(bg => bg.remove());
            });
        });
    }
    // 回车键触发搜索
    const searchBox = document.getElementById("searchBox");
    if (searchBox && btn) {
        searchBox.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                btn.click();
            }
        });
    }

    if (searchBox) {
        searchBox.addEventListener("input", function () {
            const keyword = searchBox.value.trim();
            const resultCountEl = document.getElementById("search-result-count");
            const upBtn = document.getElementById("search-up-btn");
            const downBtn = document.getElementById("search-down-btn");
            if (!keyword) {
                resultCountEl && (resultCountEl.style.display = "none");
                upBtn && (upBtn.style.display = "none");
                downBtn && (downBtn.style.display = "none");
            }
        });
    }

    if (btn) {

        btn.addEventListener("click", function () {
            vscode.postMessage({
                command: "EVENT_SEARCH"
            });
            const svg = document.querySelector("svg");
            if (!svg) { return; }

            // 获取搜索关键词
            const input = document.getElementById("searchBox");
            const keyword = input ? input.value.trim().toLowerCase() : "";
            window.localStorage.setItem(STORAGE_KEYS.keyword, keyword);
            // console.log("1.当前搜索关键词:", keyword);
            // console.log("1.当前搜索关键词的key:", STORAGE_KEYS.keyword);

            // 统计并更新结果数量
            let matchCount = 0;
            matchedNodes = []; // 用于存储所有匹配到的g.node
            currentSearchIndex = -1;
            lastKeyword = keyword;

            // 用于存储所有匹配节点的索引
            let matchedNodeIndexes = [];                           // 新增
            svg.querySelectorAll("g.node").forEach((g) => {
                // 获取节点文本
                const textEl = g.querySelector("text");
                const nodeText = textEl ? textEl.textContent.trim().toLowerCase() : "";
                let isMatched = false; // 当前节点是否匹配
                // 处理 path/polygon
                ["path", "polygon"].forEach(tag => {
                    const shape = g.querySelector(tag);
                    if (shape) {
                        // 首次高亮时保存原色
                        if (!shape.hasAttribute("data-original-fill")) {
                            shape.setAttribute("data-original-fill", shape.getAttribute("fill") || "");
                        }
                        // 模糊匹配
                        if (keyword && nodeText.includes(keyword)) {
                            shape.setAttribute("fill", "orange");
                            isMatched = true;
                        } else {
                            // 恢复原色
                            const orig = shape.getAttribute("data-original-fill");
                            if (orig !== null) {
                                shape.setAttribute("fill", orig);
                            }
                        }
                    }
                });
                if (isMatched) {
                    matchCount++;
                    matchedNodes.push(g);
                    // matchedNodeIndexes.push(idx); // 移除：索引应在排序后统一生成
                }
                nodesHighlighted = !nodesHighlighted;
            });

            // 高亮子图：只高亮文本中与keyword匹配的部分
            svg.querySelectorAll("g.cluster").forEach(g => {
                const textEl = g.querySelector("text");
                if (!textEl) return;

                const clusterText = textEl.textContent.trim();
                const clusterTextLower = clusterText.toLowerCase();

                // 移除已有的所有背景
                const oldBgs = g.querySelectorAll("rect.cluster-text-bg");
                oldBgs.forEach(bg => bg.remove());

                if (keyword && clusterTextLower.includes(keyword)) {
                    matchCount++;
                    matchedNodes.push(g);
                    // 找到所有匹配位置
                    const matches = [];
                    let startIndex = 0;
                    while (true) {
                        const index = clusterTextLower.indexOf(keyword, startIndex);
                        if (index === -1) break;
                        matches.push({ start: index, end: index + keyword.length });
                        startIndex = index + 1;
                    }

                    if (matches.length > 0) {
                        // 获取原始文本的位置和尺寸信息
                        const textX = parseFloat(textEl.getAttribute("x")) || 0;
                        const textY = parseFloat(textEl.getAttribute("y")) || 0;
                        const textAnchor = textEl.getAttribute("text-anchor") || "start";
                        const textBBox = textEl.getBBox();

                        matches.forEach((match, i) => {
                            // 使用精确的字符级别测量
                            const beforeText = clusterText.substring(0, match.start);
                            const matchText = clusterText.substring(match.start, match.end);

                            // 创建更精确的临时测量元素，完全复制原文本的属性
                            const measureEl = textEl.cloneNode(false);
                            measureEl.style.visibility = "hidden";
                            measureEl.style.pointerEvents = "none";

                            // 添加到 DOM 中并等待字体渲染完成
                            textEl.parentNode.appendChild(measureEl);

                            // 强制浏览器重新计算样式和布局
                            measureEl.offsetHeight;

                            // 等待一个微任务确保渲染完成
                            setTimeout(() => {
                                try {
                                    // 测量匹配部分之前的文本宽度
                                    measureEl.textContent = beforeText;
                                    let beforeWidth = 0;
                                    if (beforeText) {
                                        // 强制重新计算
                                        measureEl.offsetHeight;
                                        beforeWidth = measureEl.getComputedTextLength ?
                                            measureEl.getComputedTextLength() :
                                            measureEl.getBBox().width;
                                    }

                                    // 测量匹配部分的宽度
                                    measureEl.textContent = matchText;
                                    // 强制重新计算
                                    measureEl.offsetHeight;
                                    const matchWidth = measureEl.getComputedTextLength ?
                                        measureEl.getComputedTextLength() :
                                        measureEl.getBBox().width;

                                    // 移除临时元素
                                    measureEl.remove();

                                    // 更精确的位置计算
                                    let rectX;
                                    if (textAnchor === "middle") {
                                        // 对于居中对齐，从文本中心位置开始计算
                                        rectX = textX - textBBox.width / 2 + beforeWidth;
                                    } else if (textAnchor === "end") {
                                        // 对于右对齐，从文本右端开始计算
                                        rectX = textX - textBBox.width + beforeWidth;
                                    } else {
                                        // 对于左对齐（start），直接从文本起始位置计算
                                        rectX = textX + beforeWidth;
                                    }

                                    // 创建更精确的背景矩形
                                    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                                    rect.setAttribute("x", rectX);
                                    rect.setAttribute("y", textBBox.y);
                                    rect.setAttribute("width", matchWidth);
                                    rect.setAttribute("height", textBBox.height);
                                    rect.setAttribute("fill", "orange");
                                    rect.setAttribute("fill-opacity", "0.7");
                                    rect.setAttribute("rx", "1");
                                    rect.setAttribute("class", "cluster-text-bg");

                                    // 插入到text前面，确保文本在背景之上
                                    textEl.parentNode.insertBefore(rect, textEl);

                                    // 修复：插入rect后立即刷新导航高亮
                                    if (typeof navigateToSearchResult === "function" && typeof currentSearchIndex === "number" && currentSearchIndex >= 0) {
                                        navigateToSearchResult(currentSearchIndex);
                                    }
                                } catch (e) {
                                    console.warn("Failed to measure text or create highlight:", e);
                                    // 如果测量失败，移除临时元素
                                    if (measureEl.parentNode) {
                                        measureEl.remove();
                                    }
                                }
                            }, 0);
                        });
                    }
                }
            });

            if (matchCount > 0) {
                // 按实际渲染后的 y 坐标排序，确保导航顺序和视觉一致
                matchedNodes.sort((a, b) => {
                    function getCenter(g) {
                        // 优先使用文本元素的中心点坐标
                        const textEl = g.querySelector("text");
                        if (textEl) {
                            const textBBox = textEl.getBBox();
                            return {
                                x: textBBox.x + textBBox.width / 2,
                                y: textBBox.y + textBBox.height / 2
                            };
                        }
                        // 如果没有文本元素，再使用path/polygon的边界框
                        const shape = g.querySelector("path") || g.querySelector("polygon");
                        if (!shape) return { x: 0, y: 0 };
                        const bbox = shape.getBBox();
                        return {
                            x: bbox.x + bbox.width / 2,
                            y: bbox.y + bbox.height / 2
                        };
                    }
                    const ac = getCenter(a);
                    const bc = getCenter(b);
                    // if (Math.round(ac.x) !== Math.round(bc.x)) {
                    //     return Math.round(ac.x) - Math.round(bc.x);
                    // }
                    if (Math.abs(ac.x - bc.x) > 5) {
                        return ac.x - bc.x;
                    }
                    return ac.y - bc.y;
                });
                // matchedNodeIndexes 按排序后顺序生成，确保与 matchedNodes 顺序一致
                matchedNodeIndexes = matchedNodes.map(g => Array.from(svg.querySelectorAll("g.node")).indexOf(g));
                // console.log("1.matchedNodeIndexes的结果是:", matchedNodeIndexes);
                // matchedNodeIndexes.forEach(idx => {console.log("索引", idx, "对应的节点是:", svg.querySelectorAll("g.node")[idx]);});
                currentSearchIndex = 0;
                // 持久化 matchedNodeIndexes 和 currentSearchIndex
                window.localStorage.setItem(STORAGE_KEYS.matchedIndexes, JSON.stringify(matchedNodeIndexes));
                window.localStorage.setItem(STORAGE_KEYS.currentIndex, currentSearchIndex.toString());
                navigateToSearchResult(0);
            } else {
                // 没有结果时清空本地存储
                window.localStorage.removeItem(STORAGE_KEYS.matchedIndexes);
                window.localStorage.removeItem(STORAGE_KEYS.currentIndex);
            }
            updateSearchResultDisplay();

        });
    }

    // 导航到指定的搜索结果
    function navigateToSearchResult(index) {
        // console.log("已执行到Navigating to search result:", index);
        // console.log("当前匹配到的节点数量：", matchedNodes.length);
        if (matchedNodes.length === 0) return;

        // 先恢复所有匹配项的颜色
        matchedNodes.forEach(g => {
            if (g.classList.contains("cluster")) {
                // 处理子图：恢复文本背景为普通橙色
                const textBgs = g.querySelectorAll("rect.cluster-text-bg");
                textBgs.forEach(bg => {
                    bg.setAttribute("fill", "orange");
                    bg.setAttribute("fill-opacity", "0.7");
                });
            } else {
                // 处理节点：恢复为橙色
                ["path", "polygon"].forEach(tag => {
                    const shape = g.querySelector(tag);
                    if (shape) {
                        shape.setAttribute("fill", "orange");
                    }
                });
            }
        });

        // 给当前 index 对应项添加特殊高亮色（导航当前项）
        const targetItem = matchedNodes[index];
        if (targetItem) {
            if (targetItem.classList.contains("cluster")) {
                console.log("当前导航到的子图:", targetItem);
                // 处理子图：将匹配文本的背景改为深色突出显示
                let textBgs = targetItem.querySelectorAll("rect.cluster-text-bg");
                // 如果没有高亮 rect，主动生成
                if (textBgs.length === 0) {
                    const textEl = targetItem.querySelector("text");
                    if (textEl) {
                        const clusterText = textEl.textContent.trim();
                        const clusterTextLower = clusterText.toLowerCase();
                        const keyword = window.localStorage.getItem(STORAGE_KEYS.keyword) || "";
                        if (keyword && clusterTextLower.includes(keyword)) {
                            // 找到所有匹配位置
                            const matches = [];
                            let startIndex = 0;
                            while (true) {
                                const index = clusterTextLower.indexOf(keyword, startIndex);
                                if (index === -1) break;
                                matches.push({ start: index, end: index + keyword.length });
                                startIndex = index + 1;
                            }
                            if (matches.length > 0) {
                                const textX = parseFloat(textEl.getAttribute("x")) || 0;
                                const textAnchor = textEl.getAttribute("text-anchor") || "start";
                                const textBBox = textEl.getBBox();
                                matches.forEach((match, i) => {
                                    const beforeText = clusterText.substring(0, match.start);
                                    const matchText = clusterText.substring(match.start, match.end);
                                    const measureEl = textEl.cloneNode(false);
                                    measureEl.style.visibility = "hidden";
                                    measureEl.style.pointerEvents = "none";
                                    textEl.parentNode.appendChild(measureEl);
                                    measureEl.offsetHeight;
                                    try {
                                        measureEl.textContent = beforeText;
                                        let beforeWidth = 0;
                                        if (beforeText) {
                                            measureEl.offsetHeight;
                                            beforeWidth = measureEl.getComputedTextLength ?
                                                measureEl.getComputedTextLength() :
                                                measureEl.getBBox().width;
                                        }
                                        measureEl.textContent = matchText;
                                        measureEl.offsetHeight;
                                        const matchWidth = measureEl.getComputedTextLength ?
                                            measureEl.getComputedTextLength() :
                                            measureEl.getBBox().width;
                                        measureEl.remove();
                                        let rectX;
                                        if (textAnchor === "middle") {
                                            rectX = textX - textBBox.width / 2 + beforeWidth;
                                        } else if (textAnchor === "end") {
                                            rectX = textX - textBBox.width + beforeWidth;
                                        } else {
                                            rectX = textX + beforeWidth;
                                        }
                                        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                                        rect.setAttribute("x", rectX);
                                        rect.setAttribute("y", textBBox.y);
                                        rect.setAttribute("width", matchWidth);
                                        rect.setAttribute("height", textBBox.height);
                                        rect.setAttribute("fill", "#a5600c");
                                        rect.setAttribute("fill-opacity", "0.9");
                                        rect.setAttribute("rx", "1");
                                        rect.setAttribute("class", "cluster-text-bg");
                                        textEl.parentNode.insertBefore(rect, textEl);
                                    } catch (e) {
                                        if (measureEl.parentNode) {
                                            measureEl.remove();
                                        }
                                    }
                                });
                            }
                        }
                    }
                    textBgs = targetItem.querySelectorAll("rect.cluster-text-bg");
                }
                textBgs.forEach(bg => {
                    bg.setAttribute("fill", "#a5600c"); // 深橙色
                    bg.setAttribute("fill-opacity", "0.9");
                });
            } else {
                // 处理节点：改为深橙色
                ["path", "polygon"].forEach(tag => {
                    const shape = targetItem.querySelector(tag);
                    if (shape) {
                        // 保存原色
                        if (!shape.hasAttribute("data-original-fill")) {
                            shape.setAttribute("data-original-fill", shape.getAttribute("fill") || "");
                        }
                        shape.setAttribute("fill", "#a5600c"); // 深橙色
                    }
                });
            }
        }

        currentSearchIndex = index;
        updateSearchResultDisplay();
    }

    // 更新搜索结果显示
    function updateSearchResultDisplay() {
        const resultCountEl = document.getElementById("search-result-count");
        const upBtn = document.getElementById("search-up-btn");
        const downBtn = document.getElementById("search-down-btn");

        if (matchedNodes.length > 0) {
            resultCountEl.textContent = `${currentSearchIndex + 1}/${matchedNodes.length}`;
            resultCountEl.style.display = "inline";
            if (upBtn) upBtn.style.display = "inline-block";
            if (downBtn) downBtn.style.display = "inline-block";
        } else {
            resultCountEl.textContent = "0/0";
            resultCountEl.style.display = "inline";
            if (upBtn) upBtn.style.display = "inline-block";
            if (downBtn) downBtn.style.display = "inline-block";
        }
    }

    // 向上导航
    function searchUp() {
        if (matchedNodes.length === 0) return;
        let newIndex = currentSearchIndex - 1;
        if (newIndex < 0) newIndex = matchedNodes.length - 1;
        navigateToSearchResult(newIndex);
        // 持久化 currentSearchIndex
        window.localStorage.setItem(STORAGE_KEYS.currentIndex, newIndex.toString());
    }

    // 向下导航
    function searchDown() {
        if (matchedNodes.length === 0) return;
        let newIndex = currentSearchIndex + 1;
        if (newIndex >= matchedNodes.length) newIndex = 0;
        navigateToSearchResult(newIndex);
        // 持久化 currentSearchIndex
        window.localStorage.setItem(STORAGE_KEYS.currentIndex, newIndex.toString());
    }

    function clearCallGraphHighlight() {
        const svg = document.querySelector("svg");
        if (!svg) { return; }
        svg.querySelectorAll('g.edge path, g.edge polygon').forEach(el => {
            // 恢复原始颜色
            if (el.dataset.originalStroke !== undefined) {
                el.setAttribute('stroke', el.dataset.originalStroke);
                delete el.dataset.originalStroke;
            }
            // 恢复原始透明度
            if (el.dataset.originalStrokeOpacity !== undefined) {
                el.setAttribute('stroke-opacity', el.dataset.originalStrokeOpacity);
                delete el.dataset.originalStrokeOpacity;
            } else {
                el.removeAttribute('stroke-opacity'); // 没有保存则移除
            }
            // 恢复箭头端的填充色
            if (el.tagName === "polygon") {
                if (el.dataset.originalFill !== undefined) {
                    el.setAttribute('fill', el.dataset.originalFill);
                    delete el.dataset.originalFill;
                }// else {
                //     el.removeAttribute('fill');
                // }
            }
        });
    }

    // 监听 Ctrl 键按下和松开，实时刷新鼠标样式
    function updateCursor() {
        // 获取鼠标当前位置的元素
        const mousePos = window._lastMousePos;
        if (!graph || !mousePos) return;
        const element = document.elementFromPoint(mousePos.x, mousePos.y);
        const targetNode = element?.closest?.("g.node");
        if (targetNode) {
            graph.style.cursor = ctrlPressed ? "pointer" : "default";
        } else {
            graph.style.cursor = "default";
        }
    }

    function highlightCallGraphEdges(nodeTitleParam) {
        clearCallGraphHighlight(); // 先清除旧高亮

        const nodeTitle = nodeTitleParam ? nodeTitleParam : cleanNodeName(this.title);
        const svg = document.querySelector("svg");
        if (!svg) return;

        // 1. 构建邻接表和反向邻接表
        const adjacency = {};
        const reverseAdjacency = {};
        const allNodes = new Set();

        svg.querySelectorAll('g.edge').forEach(edge => {
            const titleEl = edge.querySelector('title');
            if (titleEl && titleEl.textContent) {
                // 修正邻接表构建逻辑，和高亮逻辑一致
                const idx = titleEl.textContent.indexOf('->');
                if (idx !== -1) {
                    const from = cleanNodeName(titleEl.textContent.slice(0, idx));
                    const to = cleanNodeName(titleEl.textContent.slice(idx + 2));
                    allNodes.add(from);
                    allNodes.add(to);
                    if (!adjacency[from]) adjacency[from] = [];
                    if (!reverseAdjacency[to]) reverseAdjacency[to] = [];
                    adjacency[from].push(to);
                    reverseAdjacency[to].push(from);
                }
            }
        });

        // 2. 找到所有根节点（入度为0，或只有自环）
        const roots = Array.from(allNodes).filter(node => {
            // 没有任何入边
            if (!reverseAdjacency[node]) return true;
            // 只有自环，没有其它节点指向它
            if (reverseAdjacency[node].length === 1 && reverseAdjacency[node][0] === node) return true;
            return false;
        });
        // 3. 找到所有叶子节点（出度为0）
        const leaves = Array.from(allNodes).filter(node => !adjacency[node]);

        // 4. 收集所有需要高亮的边（用字符串 "A->B" 标识）
        const highlightEdges = new Set();
        //在 DFS 收集路径时，遍历 path 上每个节点，如果该节点有自环，则也把自环加入 highlightEdges，从而在点击非自环节点时自环节点的边会变成橙色
        function addSelfLoopsOnPath(path) {
            for (const node of path) {
                if (adjacency[node] && adjacency[node].includes(node)) {
                    highlightEdges.add(`${node}->${node}`);
                }
            }
        }
        //5. 从所有根到当前节点的所有路径
        function dfsToTarget(current, target, path) {
            if (current === target) {
                for (let i = 0; i < path.length - 1; i++) {
                    highlightEdges.add(`${path[i]}->${path[i + 1]}`);
                }
                addSelfLoopsOnPath(path);
                return;
            }
            if (!adjacency[current]) return;
            for (const next of adjacency[current]) {
                if (path.includes(next)) continue; // 防止环
                dfsToTarget(next, target, [...path, next]);
            }
        }

        // 调用从所有根节点到目标节点的路径查找
        for (const root of roots) {
            dfsToTarget(root, nodeTitle, [root]);
        }

        // 6. 从当前节点到所有叶子的所有路径
        function dfsFromSource(current, path) {
            if (!adjacency[current] || adjacency[current].length === 0) {
                for (let i = 0; i < path.length - 1; i++) {
                    highlightEdges.add(`${path[i]}->${path[i + 1]}`);
                }
                addSelfLoopsOnPath(path);
                return;
            }
            for (const next of adjacency[current]) {
                if (path.includes(next)) continue; // 防止环
                dfsFromSource(next, [...path, next]);
            }
        }
        dfsFromSource(nodeTitle, [nodeTitle]);
        //高亮自环（自己指向自己的边） ===
        if (adjacency[nodeTitle] && adjacency[nodeTitle].includes(nodeTitle)) {
            highlightEdges.add(`${nodeTitle}->${nodeTitle}`);
        }
        // 7. 高亮这些边
        svg.querySelectorAll('g.edge').forEach(edge => {
            const titleEl = edge.querySelector('title');
            let isHighlight = false;
            if (titleEl && titleEl.textContent) {
                // 修正高亮边的判断逻辑，和邻接表一致
                const idx = titleEl.textContent.indexOf('->');
                if (idx !== -1) {
                    const from = cleanNodeName(titleEl.textContent.slice(0, idx));
                    const to = cleanNodeName(titleEl.textContent.slice(idx + 2));
                    const key = `${from}->${to}`;
                    if (highlightEdges.has(key)) {
                        isHighlight = true;
                    }
                }
            }
            edge.querySelectorAll('path, polygon').forEach(el => {

                // 只保存一次原色和透明度
                if (el.dataset.originalStroke === undefined) {
                    el.dataset.originalStroke = el.getAttribute('stroke') || getComputedStyle(el).stroke;
                }
                if (el.dataset.originalStrokeOpacity === undefined) {
                    el.dataset.originalStrokeOpacity = el.getAttribute('stroke-opacity') || getComputedStyle(el).strokeOpacity || '1';
                }
                if (el.tagName === "polygon" && el.dataset.originalFill === undefined) {
                    el.dataset.originalFill = el.getAttribute('fill') || getComputedStyle(el).fill;
                }
                if (isHighlight) {
                    // 高亮边：原色
                    if (el.dataset.originalStroke !== undefined) {
                        el.setAttribute('stroke', el.dataset.originalStroke);
                    }
                    if (el.dataset.originalStrokeOpacity !== undefined) {
                        el.setAttribute('stroke-opacity', el.dataset.originalStrokeOpacity);
                    } else {
                        el.removeAttribute('stroke-opacity');
                    }
                    if (el.tagName === "polygon" && el.dataset.originalFill !== undefined) {
                        el.setAttribute('fill', el.dataset.originalFill);
                    }
                } else {
                    //非高亮边：颜色变淡
                    el.setAttribute('stroke', 'rgba(51,51,51,0.2)');
                    el.setAttribute('stroke-opacity', '0.2');
                    if (el.tagName === "polygon") {
                        el.setAttribute('fill', 'rgba(51,51,51,0.2)');
                    }
                }
            });
        });
    }




    function addWatermark() {
        // 检查是否已存在
        if (document.getElementById("walle-watermark-div")) return;

        const div = document.createElement("div");
        div.id = "walle-watermark-div";
        div.textContent = "Tip: Select the node and right-click to generate Reference Graph.";
        // 设置样式：右上角固定，半透明，禁止鼠标事件
        div.style.position = "fixed";
        div.style.top = "10px";
        div.style.right = "20px";
        div.style.zIndex = "9999";
        div.style.fontSize = "20px";
        div.style.color = "#a9a9aa";
        div.style.opacity = "0.7";
        div.style.pointerEvents = "none";
        div.style.userSelect = "none";
        div.style.fontWeight = "bold";
        document.body.appendChild(div);
    }


    // document.selec

    /**
     * 折叠节点信息
     */
    function refNodeCallGraph() {
        if (this.title) {
            vscode.postMessage({
                command: "EVENT_CALL_FUNC_GRAPH",
                data: this.title,
            });
        } else {
            console.warn("No node is selected or the node has no title information");
        }
    }

    /**
     * 导出 SVG
     */
    function exportSVG() {
        const svgElement = document.querySelector("svg");
        if (!svgElement) {
            console.warn("No SVG element found");
            return;
        }
        // 重置缩放和平移
        panZoomInstance.zoomAbs(0, 0, 1);
        panZoomInstance.moveTo(0, 0);
        // 等待一帧，确保视图更新完
        requestAnimationFrame(() => {
            vscode.postMessage({
                command: "EVENT_EXPORT_SVG",
                svg: svgElement.outerHTML,
            });
        });
    }

    /**
     * 导出 CSV
     */
    function exportCSV() {
        vscode.postMessage({
            command: "EVENT_EXPORT_CSV",
        });
    }
    function nodeInfoCopy() {
        vscode.postMessage({
            command: "EVENT_COPY",
            text: this.highlightedNodeText,
        });
    }
    function fileCopy() {
        vscode.postMessage({
            command: "EVENT_FILE_PATH_COPY",
            text: this.highlightedNodeText,
        });
    }
    function jumpToFunction() {
        vscode.postMessage({
            command: "EVENT_JUMP2CODE",
            data: this.title,
        });
    }
    function refMultipleCallGraph() {
        vscode.postMessage({
            command: "EVENT_CALL_MULTIPLE_FUNC_GRAPH",
            data: this.title,
        });
    }
    function allfilesCallGraph() {
        vscode.postMessage({
            command: "EVENT_CALL_ALL_FILES_FUNC_GRAPH",
            data: this.title,
        });
    }
    function generateFeatureFileAnalysisResult(source) {
        vscode.postMessage({
            command: "EVENT_FEATURE_DEEPDIVE_ANALYSIS",
            data: this.title, // 传递节点路径
            source: source || ""
        });
    }
    function outgoingCallGraph() {
        vscode.postMessage({
            command: "EVENT_OUTGOING_CALL_GRAPH",
            data: this.title,
        });
    }

    function clearOutgoingEdgeHighlight() {
        const svg = document.querySelector("svg");
        if (!svg) { return; }
        svg.querySelectorAll('g.edge path, g.edge polygon').forEach(el => {
            // 恢复原始颜色
            if (el.dataset.originalStroke !== undefined) {
                el.setAttribute('stroke', el.dataset.originalStroke);
                delete el.dataset.originalStroke;
            }
            // 恢复原始透明度
            if (el.dataset.originalStrokeOpacity !== undefined) {
                el.setAttribute('stroke-opacity', el.dataset.originalStrokeOpacity);
                delete el.dataset.originalStrokeOpacity;
            } else {
                el.removeAttribute('stroke-opacity'); // 没有保存则移除
            }
            // 恢复箭头端的填充色
            if (el.tagName === "polygon") {
                if (el.dataset.originalFill !== undefined) {
                    el.setAttribute('fill', el.dataset.originalFill);
                    delete el.dataset.originalFill;
                }// else {
                //     el.removeAttribute('fill');
                // }
            }
        });
    }

    // 监听 Ctrl 键按下和松开，实时刷新鼠标样式
    function updateCursor() {
        // 获取鼠标当前位置的元素
        const mousePos = window._lastMousePos;
        if (!graph || !mousePos) return;
        const element = document.elementFromPoint(mousePos.x, mousePos.y);
        const targetNode = element?.closest?.("g.node");
        if (targetNode) {
            graph.style.cursor = ctrlPressed ? "pointer" : "default";
        } else {
            graph.style.cursor = "default";
        }
    }
    function highlightOutgoingEdges() {
        clearOutgoingEdgeHighlight(); // 先清除旧高亮

        const nodeTitle = this.title;
        const svg = document.querySelector("svg");
        if (!svg) return;

        // 1. 构建邻接表和反向邻接表
        const adjacency = {};
        const reverseAdjacency = {};
        const allNodes = new Set();

        svg.querySelectorAll('g.edge').forEach(edge => {
            const titleEl = edge.querySelector('title');
            if (titleEl && titleEl.textContent) {
                // 避免节点名称包含->的情况 
                //const idx = cleanNodeName(titleEl.textContent).indexOf('->/');
                const idx = titleEl.textContent.indexOf('->Tips');
                if (idx !== -1) {
                    const from = cleanNodeName(titleEl.textContent.slice(0, idx)).trim();
                    const to = cleanNodeName(titleEl.textContent.slice(idx + 2)).trim();
                    allNodes.add(from);
                    allNodes.add(to);
                    if (!adjacency[from]) adjacency[from] = [];
                    if (!reverseAdjacency[to]) reverseAdjacency[to] = [];
                    adjacency[from].push(to);
                    reverseAdjacency[to].push(from);
                }
            }
        });

        // 2. 找到所有根节点（入度为0）
        const roots = Array.from(allNodes).filter(node => !reverseAdjacency[node]);

        // 3. 找到所有叶子节点（出度为0）
        const leaves = Array.from(allNodes).filter(node => !adjacency[node]);

        // 4. 收集所有需要高亮的边（用字符串 "A->B" 标识）
        const highlightEdges = new Set();
        //在 DFS 收集路径时，遍历 path 上每个节点，如果该节点有自环，则也把自环加入 highlightEdges，从而在点击非自环节点时自环节点的边会变成橙色
        function addSelfLoopsOnPath(path) {
            for (const node of path) {
                if (adjacency[node] && adjacency[node].includes(node)) {
                    highlightEdges.add(`${node}->${node}`);
                }
            }
        }
        // 5. 从所有根到当前节点的所有路径
        function dfsToTarget(current, target, path) {
            if (current === target) {
                for (let i = 0; i < path.length - 1; i++) {
                    highlightEdges.add(`${path[i]}->${path[i + 1]}`);
                }
                addSelfLoopsOnPath(path);
                return;
            }
            if (!adjacency[current]) return;
            for (const next of adjacency[current]) {
                if (path.includes(next)) continue; // 防止环
                dfsToTarget(next, target, [...path, next]);
            }
        }
        roots.forEach(root => {
            dfsToTarget(root, nodeTitle, [root]);
        });

        // 6. 从当前节点到所有叶子的所有路径
        function dfsFromSource(current, path) {
            if (!adjacency[current] || adjacency[current].length === 0) {
                for (let i = 0; i < path.length - 1; i++) {
                    highlightEdges.add(`${path[i]}->${path[i + 1]}`);
                }
                addSelfLoopsOnPath(path);
                return;
            }
            for (const next of adjacency[current]) {
                if (path.includes(next)) continue; // 防止环
                dfsFromSource(next, [...path, next]);
            }
        }
        dfsFromSource(nodeTitle, [nodeTitle]);
        //高亮自环（自己指向自己的边） ===
        if (adjacency[nodeTitle] && adjacency[nodeTitle].includes(nodeTitle)) {
            highlightEdges.add(`${nodeTitle}->${nodeTitle}`);
        }
        // 7. 高亮这些边
        svg.querySelectorAll('g.edge').forEach(edge => {
            const titleEl = edge.querySelector('title');
            let isHighlight = false;
            if (titleEl && titleEl.textContent) {
                // 避免节点名称包含->的情况
                //const idx = cleanNodeName(titleEl.textContent).indexOf('->/');
                const idx = titleEl.textContent.indexOf('->Tips');
                if (idx !== -1) {
                    const from = cleanNodeName(titleEl.textContent.slice(0, idx)).trim();
                    const to = cleanNodeName(titleEl.textContent.slice(idx + 2)).trim();
                    const key = `${from}->${to}`;
                    if (highlightEdges.has(key)) {
                        isHighlight = true;
                    }
                }
            }
            edge.querySelectorAll('path, polygon').forEach(el => {

                //edge.querySelectorAll('path').forEach(el => {
                // 只保存一次原色和透明度
                if (el.dataset.originalStroke === undefined) {
                    el.dataset.originalStroke = el.getAttribute('stroke') || getComputedStyle(el).stroke;
                }
                if (el.dataset.originalStrokeOpacity === undefined) {
                    el.dataset.originalStrokeOpacity = el.getAttribute('stroke-opacity') || getComputedStyle(el).strokeOpacity || '1';
                }
                if (el.tagName === "polygon" && el.dataset.originalFill === undefined) {
                    el.dataset.originalFill = el.getAttribute('fill') || getComputedStyle(el).fill;
                }
                if (isHighlight) {
                    // 检查是否为虚线 - 改进检测逻辑
                    const hasStrokeDashArray = el.getAttribute('stroke-dasharray') ||
                        (el.parentElement && el.parentElement.getAttribute('stroke-dasharray'));
                    const computedDashArray = getComputedStyle(el).strokeDasharray;
                    const hasImplClass = el.parentElement && el.parentElement.classList.contains('impl');

                    const isDashed = hasStrokeDashArray ||
                        (computedDashArray && computedDashArray !== 'none') ||
                        hasImplClass;

                    if (isDashed) {
                        el.setAttribute('stroke', '#dc3545');
                        el.setAttribute('stroke-opacity', '1');
                        if (el.tagName === "polygon") {
                            el.setAttribute('fill', '#dc3545');
                        }
                    } else {
                        el.setAttribute('stroke', '#00bcd4');
                        el.setAttribute('stroke-opacity', '1');
                        if (el.tagName === "polygon") {
                            el.setAttribute('fill', '#00bcd4');
                        }
                    }
                } else {
                    el.setAttribute('stroke', 'rgba(51,51,51,0.2)');
                    el.setAttribute('stroke-opacity', '0.2');
                    if (el.tagName === "polygon") {
                        el.setAttribute('fill', 'rgba(51,51,51,0.2)');
                    }
                }
            });
        });
    }

    function cleanNodeName(name) {
        // 去掉前缀和换行,目的是不影响跳转功能
        return name.trim();
    }
    ;
    // }
    window.addEventListener("message", (e) => {
        const message = e.data;
        switch (message.command) {
            case "exportSVG":
                exportSVG();
                break;
            case "exportCSV":
                exportCSV();
                break;
            case "CLEAR_HIGHLIGHT":
                clearCallGraphHighlight();
                break;
            case "CLEAR_KEYWORD":
                window.localStorage.removeItem(STORAGE_KEYS.keyword);
                window.localStorage.removeItem(STORAGE_KEYS.matchedIndexes);
                window.localStorage.removeItem(STORAGE_KEYS.currentIndex);
                break;
            case "SVG_RENDERED_FINISH":
                // SVG和DOM已渲染完成，执行高亮
                const svg = document.querySelector("svg");
                if (svg) {
                    const nodes = Array.from(svg.querySelectorAll("g.node"));
                    function cleanNodeName(name) {
                        return name.replace(/^file:\/\/\//, "").trim();
                    }
                    const msg = cleanNodeName(message.data || window._pendingExpandNode || "");
                    const nodeGroup = nodes.find(g => {
                        const titleEl = g.querySelector("title");
                        if (!titleEl) return false;
                        const nodeTitle = cleanNodeName(titleEl.textContent);
                        return nodeTitle === msg;
                    });

                    if (!nodeGroup) {
                        console.warn("No matching node found,message.data:", message.data);
                    }
                    if (nodeGroup) {
                        nodeGroup.classList.add("active-node");  //高亮节点
                        ["path", "polygon"].forEach(tag => {
                            const shape = nodeGroup.querySelector(tag);
                            if (shape && !shape.hasAttribute("data-original-fill")) {
                                shape.setAttribute("data-original-fill", shape.getAttribute("fill") || "");
                            }
                        });
                        lastClickedNode = nodeGroup;
                        window._autoHighlightNodeTitle = cleanNodeName(nodeGroup.querySelector("title").textContent);
                        highlightCallGraphEdges(window._autoHighlightNodeTitle);
                    }

                    // 新增：SVG渲染完成后自动恢复搜索高亮和导航状态
                    // 优先使用消息中传递的keyword键名获取值，如果没有则使用默认键名
                    const keywordStorageKey = message.keyword || STORAGE_KEYS.keyword;
                    const keyword = window.localStorage.getItem(keywordStorageKey) || "";
                    // console.log("2.当前搜索关键词:", keyword);
                    // console.log("2.当前的存储键名:", keywordStorageKey);
                    // 同步填充到搜索框
                    const inputBox = document.getElementById("searchBox");
                    if (inputBox) inputBox.value = keyword;

                    // 强制同步 keyword 到当前页面的 localStorage，防止自动生成 key 导致后续无法获取
                    window.localStorage.setItem(STORAGE_KEYS.keyword, keyword);

                    if (keyword) {
                        // 重新执行搜索逻辑来恢复匹配节点和排序
                        let matchCount = 0;
                        matchedNodes = [];
                        currentSearchIndex = -1;

                        // 搜索节点并高亮
                        svg.querySelectorAll("g.node").forEach((g) => {
                            const textEl = g.querySelector("text");
                            const nodeText = textEl ? textEl.textContent.trim().toLowerCase() : "";
                            let isMatched = false;

                            ["path", "polygon"].forEach(tag => {
                                const shape = g.querySelector(tag);
                                if (shape) {
                                    if (!shape.hasAttribute("data-original-fill")) {
                                        shape.setAttribute("data-original-fill", shape.getAttribute("fill") || "");
                                    }
                                    if (nodeText.includes(keyword)) {
                                        shape.setAttribute("fill", "orange");
                                        isMatched = true;
                                    } else {
                                        const orig = shape.getAttribute("data-original-fill");
                                        if (orig !== null) {
                                            shape.setAttribute("fill", orig);
                                        }
                                    }
                                }
                            });

                            if (isMatched) {
                                matchCount++;
                                matchedNodes.push(g);
                            }
                        });

                        // 搜索和高亮子图
                        svg.querySelectorAll("g.cluster").forEach(g => {
                            const textEl = g.querySelector("text");
                            if (!textEl) return;

                            const clusterText = textEl.textContent.trim();
                            const clusterTextLower = clusterText.toLowerCase();

                            // 移除已有的所有背景
                            const oldBgs = g.querySelectorAll("rect.cluster-text-bg");
                            oldBgs.forEach(bg => bg.remove());

                            if (clusterTextLower.includes(keyword)) {
                                matchCount++;
                                matchedNodes.push(g);

                                // 找到所有匹配位置
                                const matches = [];
                                let startIndex = 0;
                                while (true) {
                                    const index = clusterTextLower.indexOf(keyword, startIndex);
                                    if (index === -1) break;
                                    matches.push({ start: index, end: index + keyword.length });
                                    startIndex = index + 1;
                                }

                                if (matches.length > 0) {
                                    const textX = parseFloat(textEl.getAttribute("x")) || 0;
                                    const textY = parseFloat(textEl.getAttribute("y")) || 0;
                                    const textAnchor = textEl.getAttribute("text-anchor") || "start";
                                    const textBBox = textEl.getBBox();

                                    matches.forEach((match, i) => {
                                        const beforeText = clusterText.substring(0, match.start);
                                        const matchText = clusterText.substring(match.start, match.end);

                                        const measureEl = textEl.cloneNode(false);
                                        measureEl.style.visibility = "hidden";
                                        measureEl.style.pointerEvents = "none";
                                        textEl.parentNode.appendChild(measureEl);
                                        measureEl.offsetHeight;

                                        setTimeout(() => {
                                            try {
                                                measureEl.textContent = beforeText;
                                                let beforeWidth = 0;
                                                if (beforeText) {
                                                    measureEl.offsetHeight;
                                                    beforeWidth = measureEl.getComputedTextLength ?
                                                        measureEl.getComputedTextLength() :
                                                        measureEl.getBBox().width;
                                                }
                                                measureEl.textContent = matchText;
                                                measureEl.offsetHeight;
                                                const matchWidth = measureEl.getComputedTextLength ?
                                                    measureEl.getComputedTextLength() :
                                                    measureEl.getBBox().width;
                                                measureEl.remove();

                                                let rectX;
                                                if (textAnchor === "middle") {
                                                    rectX = textX - textBBox.width / 2 + beforeWidth;
                                                } else if (textAnchor === "end") {
                                                    rectX = textX - textBBox.width + beforeWidth;
                                                } else {
                                                    rectX = textX + beforeWidth;
                                                }

                                                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                                                rect.setAttribute("x", rectX);
                                                rect.setAttribute("y", textBBox.y);
                                                rect.setAttribute("width", matchWidth);
                                                rect.setAttribute("height", textBBox.height);
                                                rect.setAttribute("fill", "orange");
                                                rect.setAttribute("fill-opacity", "0.7");
                                                rect.setAttribute("rx", "1");
                                                rect.setAttribute("class", "cluster-text-bg");
                                                textEl.parentNode.insertBefore(rect, textEl);
                                            } catch (e) {
                                                if (measureEl.parentNode) {
                                                    measureEl.remove();
                                                }
                                            }
                                        }, 0);
                                    });
                                }
                            }
                        });

                        if (matchCount > 0) {
                            matchedNodes.sort((a, b) => {
                                function getCenter(g) {
                                    // 优先使用文本元素的中心点坐标
                                    const textEl = g.querySelector("text");
                                    if (textEl) {
                                        const textBBox = textEl.getBBox();
                                        return {
                                            x: textBBox.x + textBBox.width / 2,
                                            y: textBBox.y + textBBox.height / 2
                                        };
                                    }
                                    // 如果没有文本元素，再使用path/polygon的边界框
                                    const shape = g.querySelector("path") || g.querySelector("polygon");
                                    if (!shape) return { x: 0, y: 0 };
                                    const bbox = shape.getBBox();
                                    return {
                                        x: bbox.x + bbox.width / 2,
                                        y: bbox.y + bbox.height / 2
                                    };
                                }
                                const ac = getCenter(a);
                                const bc = getCenter(b);
                                // if (Math.round(ac.x) !== Math.round(bc.x)) {
                                //     return Math.round(ac.x) - Math.round(bc.x);
                                // }
                                if (Math.abs(ac.x - bc.x) > 5) {
                                    return ac.x - bc.x;
                                }
                                return ac.y - bc.y;
                            });
                            // 排序完成后，打印所有排好序的节点文本坐标

                            // 重新生成 matchedNodeIndexes
                            const allNodes = Array.from(svg.querySelectorAll("g.node"));
                            const matchedNodeIndexes = matchedNodes.map(g => {
                                if (g.classList.contains("cluster")) {
                                    // 子图节点返回特殊标识
                                    return -1;
                                } else {
                                    return allNodes.indexOf(g);
                                }
                            });

                            // 从localStorage恢复当前索引
                            let currentIndex = parseInt(window.localStorage.getItem(STORAGE_KEYS.currentIndex) || "0", 10);
                            if (isNaN(currentIndex)) currentIndex = 0;

                            if (message.data && (!window.localStorage.getItem(STORAGE_KEYS.matchedIndexes) || JSON.parse(window.localStorage.getItem(STORAGE_KEYS.matchedIndexes)).length === 0)) {
                                currentSearchIndex = 0;
                            } else {
                                currentSearchIndex = Math.max(0, Math.min(currentIndex, matchedNodes.length - 1));
                            }

                            // 更新localStorage
                            window.localStorage.setItem(STORAGE_KEYS.matchedIndexes, JSON.stringify(matchedNodeIndexes));
                            window.localStorage.setItem(STORAGE_KEYS.currentIndex, currentSearchIndex.toString());

                            navigateToSearchResult(currentSearchIndex);
                        } else {
                            currentSearchIndex = -1;
                            // 清空localStorage
                            window.localStorage.removeItem(STORAGE_KEYS.matchedIndexes);
                            window.localStorage.removeItem(STORAGE_KEYS.currentIndex);
                        }
                        updateSearchResultDisplay();
                    }
                }
                window._pendingExpandNode = null;
                break;
        }
    });
})();

