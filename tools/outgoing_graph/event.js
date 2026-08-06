(function () {
    // ============================================================================
    // 全局变量和初始化
    // ============================================================================
    const vscode = acquireVsCodeApi();
    const { treeData, rootId,pinImageUri, pinFillImageUri, filterConfig } = window.CallGraphInit;

    // 全局状态管理（Ctrl 按下状态 + 当前悬停的节点标签）
    let isCtrlPressed = false;
    let currentHoveredLabel = null;

    // function getNodeDepth(li) {
    // let depth = 0;
    // let current = li;
    // while (current && current.parentElement) {
    //     if (current.parentElement.tagName === 'UL') {
    //         depth++;
    //     }
    //     current = current.parentElement.parentElement;
    //     if (current && current.tagName !== 'LI') break;
    // }
    // return depth;
    // }
    // 生成包含过滤信息的缓存键
    function generateCacheKey(baseRootId) {
        // 获取当前过滤配置的哈希值
        const filterConfig = getFilterConfig();
        const filterHash = generateFilterHash(filterConfig);
        return baseRootId + '_filter_' + filterHash;
    }

    // 获取当前过滤配置
    function getFilterConfig() {
        // 使用从后端传递过来的过滤配置
        // 如果没有传递配置，则返回默认的空配置
        return filterConfig || {};
    }

    // 生成过滤配置的哈希值
    function generateFilterHash(config) {
        const configStr = JSON.stringify(config);
        let hash = 0;
        for (let i = 0; i < configStr.length; i++) {
            const char = configStr.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString(36);
    }
    // 存储键名
    const baseRootId = rootId;
    const cacheKey = generateCacheKey(baseRootId);
    const STORAGE_KEY = 'wall_e_outgoing_expanded_' + cacheKey;
    //const STORAGE_KEY = 'wall_e_outgoing_expanded_' + rootId;
    const SCROLL_KEY = STORAGE_KEY + '_scroll';
    const TREE_CACHE_KEY = STORAGE_KEY + '_tree_cache';
    const COLLAPSED_KEY = 'wall_e_outgoing_collapsed_' + cacheKey; // 新增：记录手动折叠的节点
    const MANUAL_EXPANDED_KEY = 'wall_e_outgoing_manual_expanded_' + cacheKey; // 新增：记录手动展开的节点
    const MANUAL_COLLAPSED_KEY = 'wall_e_outgoing_manual_collapsed_' + cacheKey; // 新增：记录手动收缩的节点

    // 搜索相关变量
    let lastHighlighted = [];
    let lastKeyword = "";
    let currentSearchIndex = -1;

    // 右键菜单相关变量
    let lastRightClickNodeData = null;

    // ============================================================================
    // 工具函数
    // ============================================================================

    // 生成唯一节点ID - 确保pin状态的一对一绑定
    function generateUniqueNodeId(nodeData, depth, index) {
        let nodeId = '';
        
        // 1. 优先使用 _itemId
        if (nodeData.item && nodeData.item._itemId) {
            nodeId = nodeData.item._itemId;
        }
        // 2. 其次使用 detail
        else if (nodeData.item && nodeData.item.detail) {
            nodeId = nodeData.item.detail;
        }
        // 3. 使用函数名 + 文件路径 + 位置信息
        else if (nodeData.item) {
            const name = nodeData.item.name || 'unknown';
            const path = (nodeData.item.uri && nodeData.item.uri.path) ? nodeData.item.uri.path : '';
            let pos = '';
            
            // 提取位置信息
            if (nodeData.item.range) {
                if (Array.isArray(nodeData.item.range) && nodeData.item.range[0]) {
                    pos = `@${nodeData.item.range[0].line}:${nodeData.item.range[0].character}`;
                } else if (nodeData.item.range.start) {
                    pos = `@${nodeData.item.range.start.line}:${nodeData.item.range.start.character}`;
                }
            }
            
            nodeId = `${name}${path}${pos}`;
        }
        
        // 4. 添加深度和索引信息以防止同级重复
        nodeId += `_d${depth}_i${index}`;
        
        // 5. 如果还是为空或可能重复，添加时间戳和随机数确保唯一性
        if (!nodeId || nodeId === '_d0_i0') {
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 8);
            nodeId = `node_${timestamp}_${random}_d${depth}_i${index}`;
        }
        
        return nodeId;
    }

    // 用 sessionStorage，vscode关闭自动清理
    function getShortName(item) {
        if (!item) return '';
        if (!item.detail) return item.name || '';
        // 安全检查 item.detail 是否为字符串
        if (typeof item.detail !== 'string') return item.name || '';
        const parts = item.detail.split("::");
        if (parts.length >= 2) {
            return parts[parts.length - 2] + "::" + parts[parts.length - 1];
        }
        return item.name || '';
    }

    // 获取 fromRanges 的首个行号
    function getFromLine(nodeData) {
        if (nodeData.fromRanges && nodeData.fromRanges[0] && nodeData.fromRanges[0][0]) {
            return nodeData.fromRanges[0][0].line;
        }
        return undefined;
    }

    // XML转义函数
    function escapeXML(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    // 排序函数，保证children有序
    function sortChildren(children) {
        return children.slice().sort((a, b) => {
            function getLineChar(node) {
                if (node.fromRanges && node.fromRanges[0] && node.fromRanges[0].start) {
                    return [node.fromRanges[0].start.line, node.fromRanges[0].start.character];
                }
                if (node.fromRanges && node.fromRanges[0] && node.fromRanges[0][0]) {
                    return [node.fromRanges[0][0].line, node.fromRanges[0][0].character];
                }
                return [Number.MAX_SAFE_INTEGER, 0];
            }
            const [aLine, aChar] = getLineChar(a);
            const [bLine, bChar] = getLineChar(b);
            return aLine !== bLine ? aLine - bLine : aChar - bChar;
        });
    }

    // ============================================================================
    // 存储相关函数
    // ============================================================================

    // 获取已展开节点id集合
    function getExpandedSet() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return new Set();
            return new Set(JSON.parse(raw));
        } catch { return new Set(); }
    }

    // 保存已展开节点id集合
    function saveExpandedSet(set) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    }

    // 获取已折叠节点id集合
    function getCollapsedSet() {
        try {
            const raw = sessionStorage.getItem(COLLAPSED_KEY);
            if (!raw) return new Set();
            return new Set(JSON.parse(raw));
        } catch { return new Set(); }
    }

    // 保存已折叠节点id集合
    function saveCollapsedSet(set) {
        sessionStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(set)));
    }

    // 获取手动展开节点id集合
    function getManualExpandedSet() {
        try {
            const raw = sessionStorage.getItem(MANUAL_EXPANDED_KEY);
            if (!raw) return new Set();
            return new Set(JSON.parse(raw));
        } catch { return new Set(); }
    }

    // 保存手动展开节点id集合
    function saveManualExpandedSet(set) {
        sessionStorage.setItem(MANUAL_EXPANDED_KEY, JSON.stringify(Array.from(set)));
    }

    // 获取手动收缩节点id集合
    function getManualCollapsedSet() {
        try {
            const raw = sessionStorage.getItem(MANUAL_COLLAPSED_KEY);
            if (!raw) return new Set();
            return new Set(JSON.parse(raw));
        } catch { return new Set(); }
    }

    // 保存手动收缩节点id集合
    function saveManualCollapsedSet(set) {
        sessionStorage.setItem(MANUAL_COLLAPSED_KEY, JSON.stringify(Array.from(set)));
    }

    // 递归收集节点及其所有子节点的ID
    function collectNodeAndChildren(li, depth, index, nodeSet) {
        if (li.__nodeData) {
            const nodeId = generateUniqueNodeId(li.__nodeData, depth, index);
            nodeSet.add(nodeId);
        }
        
        // 递归处理子节点
        const ul = li.querySelector(':scope > ul');
        if (ul) {
            const childLis = ul.querySelectorAll(':scope > li');
            childLis.forEach((childLi, childIndex) => {
                collectNodeAndChildren(childLi, depth + 1, childIndex, nodeSet);
            });
        }
    }

    // 从集合中移除节点及其所有子节点的ID
    function removeNodeAndChildren(li, depth, index, nodeSet) {
        if (li.__nodeData) {
            const nodeId = generateUniqueNodeId(li.__nodeData, depth, index);
            nodeSet.delete(nodeId);
        }
        
        // 递归处理子节点
        const ul = li.querySelector(':scope > ul');
        if (ul) {
            const childLis = ul.querySelectorAll(':scope > li');
            childLis.forEach((childLi, childIndex) => {
                removeNodeAndChildren(childLi, depth + 1, childIndex, nodeSet);
            });
        }
    }

    // 保存最新 treeData 到 sessionStorage
    function saveTreeCache(tree) {
        try {
            sessionStorage.setItem(TREE_CACHE_KEY, JSON.stringify(tree));
        } catch (e) {
            console.error("Failed to save tree cache:", e);
        }
    }

    // 读取缓存 treeData
    function loadTreeCache() {
        try {
            const raw = sessionStorage.getItem(TREE_CACHE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.error("Failed to load tree cache:", e);
            return null;
        }
    }

    // ============================================================================
    // 滚动位置相关函数
    // ============================================================================

    // 滚动位置保存与恢复
    function saveScroll() {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({x: window.scrollX, y: window.scrollY}));
    }

    function restoreScroll() {
        try {
            const raw = sessionStorage.getItem(SCROLL_KEY);
            if (!raw) return;
            const pos = JSON.parse(raw);
            if (typeof pos.x === 'number' && typeof pos.y === 'number') {
                window.scrollTo(pos.x, pos.y);
            }
        } catch {}
    }

    // ============================================================================
    // 全局键盘事件监听
    // ============================================================================

    // 全局监听 Ctrl 键，同步光标状态（只绑定一次）
    window.addEventListener("keydown", function(e) {
        if (e.key === "Control") {
            isCtrlPressed = true;
            // 若当前有悬停的节点标签，立即更新光标
            if (currentHoveredLabel) {
                currentHoveredLabel.style.cursor = "pointer";
            }
        }
    });

    window.addEventListener("keyup", function(e) {
        if (e.key === "Control") {
            isCtrlPressed = false;
            // 若当前有悬停的节点标签，立即恢复光标
            if (currentHoveredLabel) {
                currentHoveredLabel.style.cursor = "default";
            }
        }
    });

    // ============================================================================
    // 树节点渲染相关函数
    // ============================================================================

    // 折叠箭头渲染函数
    function setArrow(expandIcon, isExpanded) {
        if (!expandIcon) return; // 防御性处理，避免 null 报错
        if (isExpanded) {
            // 向下箭头
            expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="3,5 8,13 13,5" fill="#4a4a4a"/></svg>';
        } else {
            // 向右箭头
            expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="5,3 13,8 5,13" fill="#4a4a4a"/></svg>';
        }
    }

    // 高亮节点函数
    function highlightNode(li) {
        const treeRoot = document.getElementById("tree-root");
        if (treeRoot) {
            // 清除之前的高亮
            const highlightedLis = treeRoot.querySelectorAll("li.node-highlight");
            highlightedLis.forEach(node => node.classList.remove("node-highlight"));
        }
        li.classList.add("node-highlight");

         // 保存高亮节点ID，用于后续恢复
        if (li.__nodeData) {
            const nodeId = generateUniqueNodeId(li.__nodeData, li.__depth || 0, li.__index || 0);
            sessionStorage.setItem('wall_e_outgoing_highlight_' + rootId, nodeId);
        }
    }

    // 撤销所有节点高亮和右键菜单
    function clearNodeHighlightAndMenus() {
        const treeRoot = document.getElementById("tree-root");
        if (treeRoot) {
            const highlightedLis = treeRoot.querySelectorAll("li.node-highlight");
            highlightedLis.forEach(node => node.classList.remove("node-highlight"));
        }
        const contextMenuOutgoingNode = document.getElementById('context-menu-outgoing-node');
        const contextMenuBlank = document.getElementById('context-menu-blank');
        if (contextMenuOutgoingNode) contextMenuOutgoingNode.style.display = 'none';
        if (contextMenuBlank) contextMenuBlank.style.display = 'none';
    }

    // 递归渲染树节点，支持展开状态恢复
    function createTreeNode(nodeData, depth = 0, index = 0) {
        const li = document.createElement("li");
        const labelSpan = document.createElement("span");
        labelSpan.className = "node-label";
        
        const fromLine = getFromLine(nodeData);
        // 获取函数参数，不再从nodeData中获取，改为按需加载
        const funcName = getShortName(nodeData.item) || '';
        labelSpan.textContent = funcName + '()'; // 默认显示空括号
        // 先计算nodeId - 确保唯一性
        const nodeId = generateUniqueNodeId(nodeData, depth, index);
        // // 先计算nodeId
        // const nodeId = nodeData.item && nodeData.item._itemId ? nodeData.item._itemId : (nodeData.item && nodeData.item.detail ? nodeData.item.detail : '');
        // 添加 pin.png 图标
        const pinImg = document.createElement("img");
        pinImg.src = pinImageUri; // 确保 pin.png 路径正确
        pinImg.alt = "Pin";
        pinImg.className = "node-pin-icon";
        pinImg.style.height = "16px";
        pinImg.style.verticalAlign = "middle";
        pinImg.style.marginLeft = "6px";
        pinImg.style.display = "none"; // 初始隐藏pin图标
        labelSpan.appendChild(pinImg);
        
        // 恢复pin状态（移到appendChild之后，确保DOM结构完整）
        restorePinState(nodeId, pinImg);
        // 给pin图标添加点击事件
        pinImg.addEventListener("click", function(e) {
            e.stopPropagation(); // 防止触发其他点击事件
            
            // 切换pin状态
            const isPinned = this.getAttribute('data-pinned') === 'true';
            const newPinnedState = !isPinned;
            
            // 更新图标和背景颜色
            if (newPinnedState) {
                this.src = pinFillImageUri; // 切换到填充的pin
                this.setAttribute('data-pinned', 'true');
                li.classList.add('pinned-node'); // 添加蓝色背景样式
                 vscode.postMessage({
                    command: "EVENT_OUTGOING_TREE_PIN",
                    
                });
            } else {
                this.src = pinImageUri; // 切换回空心的pin
                this.setAttribute('data-pinned', 'false');
                li.classList.remove('pinned-node'); // 移除蓝色背景样式
                 vscode.postMessage({
                    command: "EVENT_OUTGOING_TREE_UNPIN",
                    
                });
            }
            
            // 可选：保存pin状态到sessionStorage或发送到后端
            savePinState(nodeId, newPinnedState);
        });
      
        // 默认光标
        li.style.cursor = "default";
        
        // 鼠标移入节点标签：记录悬停状态 + 根据 Ctrl 设光标 + 显示pin图标
        labelSpan.addEventListener("mouseover", function() {
            currentHoveredLabel = this; // 记录当前悬停的标签
            this.style.cursor = isCtrlPressed ? "pointer" : "default"; // 实时同步 Ctrl 状态
            
            // 隐藏所有其他节点的pin图标（除了已pinned的）
            const allPinIcons = document.querySelectorAll('.node-pin-icon');
            allPinIcons.forEach(icon => {
                const isPinned = icon.getAttribute('data-pinned') === 'true';
                if (!isPinned) {
                    icon.style.display = "none";
                }
            });
            
            // 显示当前节点的pin图标
            const pinIcon = this.querySelector('.node-pin-icon');
            if (pinIcon) {
                pinIcon.style.display = "inline";
            }
        });
        
        // 鼠标移出节点标签：清空悬停状态 + 恢复默认光标 + 隐藏pin图标
        labelSpan.addEventListener("mouseout", function() {
            currentHoveredLabel = null; // 清空悬停记录
            this.style.cursor = "default";
            
            // 隐藏当前节点的pin图标（除非已pinned）
            const pinIcon = this.querySelector('.node-pin-icon');
            if (pinIcon) {
                const isPinned = pinIcon.getAttribute('data-pinned') === 'true';
                if (!isPinned) {
                    pinIcon.style.display = "none";
                }
            }
        });
        
        // 设置hover tooltip
        setupNodeTooltip(labelSpan, nodeData, fromLine);
        
        li.appendChild(labelSpan);
        
        
        // 节点点击事件
        li.addEventListener("click", function(e) {
            e.stopPropagation();
            highlightNode(li);
            // 点击 li 时关闭右键菜单
            document.getElementById('context-menu-outgoing-node').style.display = 'none';
            document.getElementById('context-menu-blank').style.display = 'none';
        });
        
        // 跳转到代码
        labelSpan.addEventListener("click", function(e) {
            e.stopPropagation();
            highlightNode(li);
            // 点击关闭右键菜单
            document.getElementById('context-menu-outgoing-node').style.display = 'none';
            document.getElementById('context-menu-blank').style.display = 'none';
            if (!e.ctrlKey) {
                return;
            }
            
            const to = nodeData.item && nodeData.item.to ? nodeData.item.to : nodeData.item;
            if (to && to.uri && to.selectionRange) {
                const filePath = to.uri.path || '';
                const funcName = to.name || '';
                let line = 1, character = 0;
                if (Array.isArray(to.selectionRange) && to.selectionRange[0]) {
                    line = to.selectionRange[0].line +1 || 1;
                    character = to.selectionRange[0].character || 0;
                }
                const msg = filePath + '#' + funcName + '@' + line + ':' + character;
                vscode.postMessage({
                    command: "EVENT_JUMP2CODE",
                    data: msg
                });
            }
        });
        
        li.__nodeData = nodeData;
        const hasChildren = (nodeData.children && nodeData.children.length > 0) || nodeData.hasMore === true;
        const hasMore = nodeData.hasMore === true;
        li.classList.toggle("has-children", hasChildren);
        
        if (hasChildren) {
            const expandIcon = document.createElement("span");
            expandIcon.className = "expand-icon";
            li.insertBefore(expandIcon, labelSpan);

            const ul = document.createElement("ul");
            if (hasChildren) {
                // 保证每次渲染都按行号排序
                const sortedChildren = sortChildren(nodeData.children);
                sortedChildren.forEach((child, childIndex) => {
                    ul.appendChild(createTreeNode(child, depth + 1, childIndex));
                });

            }
            li.appendChild(ul);

            // 融合层级选择器的展开信息
            const expandedSet = getExpandedSet();
            //const expandedDepth = parseInt(sessionStorage.getItem('wall_e_outgoing_expanded_depth_' + rootId), 10);
            const isRoot = depth === 0 && index === 0;
            //let shouldExpand = false;
            if (expandedSet.has(nodeId) || isRoot) {
//                  shouldExpand = true;
//             } else if (expandedDepth && !isNaN(expandedDepth) && depth < expandedDepth) {
//                 shouldExpand = true;
//                 expandedSet.add(nodeId); // 层级展开时同步到 expandedSet
//                 saveExpandedSet(expandedSet);
//              } else if (expandedDepth && !isNaN(expandedDepth) && depth > expandedDepth) {
//     shouldExpand = false;
//     expandedSet.delete(nodeId);
//     saveExpandedSet(expandedSet);
// }

//             if (shouldExpand) {
                li.classList.add("expanded");
                setArrow(expandIcon, true);
            } else {
                setArrow(expandIcon, false);
            }
            
            // 展开图标点击事件
            setupExpandIconClick(expandIcon, li, nodeData, nodeId, depth, index);
        }
        
        return li;
    }

    // 设置节点tooltip
    function setupNodeTooltip(labelSpan, nodeData, fromLine) {
        const to = nodeData.item && nodeData.item.to ? nodeData.item.to : nodeData.item;
        let hoverInfo = '';
        if (to && to.uri && to.name && to.selectionRange) {
            const filePath = to.uri.path || '';
            const funcName = to.name || '';
            let line = 0, character = 0;
            if (Array.isArray(to.selectionRange) && to.selectionRange[0]) {
                line = (to.selectionRange[0].line || 0) + 1;
                character = to.selectionRange[0].character || 0;
            }
            hoverInfo = 'referenced-in: ' + 'line ' + (fromLine + 1) + '<br>defined-in: ' + filePath + '#' + funcName + '@' + line + ';' + character;
        }
        
        labelSpan.addEventListener('mouseenter', function(e) {
            if (!hoverInfo) return;
            
            const tooltip = document.createElement('div');
            tooltip.className = 'custom-hover-tooltip';
            // 第一行显示函数名称和搜索状态，第二行显示位置信息
            const displayFuncName = getShortName(nodeData.item) || '';
            tooltip.innerHTML = '<span class="function-signature">' + displayFuncName + '():<span class="parameters-loading">Searching parameters list...</span></span><br>' + hoverInfo; 
            document.body.appendChild(tooltip);
            
            const rect = labelSpan.getBoundingClientRect();
            const left = rect.right + 8 + window.scrollX;
            const top = rect.top + window.scrollY;
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            
            // 请求参数信息
            const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 11);
            vscode.postMessage({
                command: "GET_FUNCTION_PARAMETERS",
                data: {
                    item: nodeData.item,
                    requestId: requestId
                }
            });
            
            // 监听参数返回，更新tooltip中的函数签名
            const parameterHandler = function(event) {
                const msg = event.data;
                if (msg && msg.command === "FUNCTION_PARAMETERS_LOADED" && msg.requestId === requestId) {
                    // 更新tooltip中的函数签名
                    const functionSignature = tooltip.querySelector('.function-signature');
                    if (functionSignature) {
                        if (msg.parameters && typeof msg.parameters === 'string' && msg.parameters.trim()) {
                            functionSignature.innerHTML = displayFuncName + '(' + msg.parameters + ')';
                        } else {
                            functionSignature.innerHTML = displayFuncName + '()';
                        }
                    }
                    
                    window.removeEventListener("message", parameterHandler);
                }
            };
            window.addEventListener("message", parameterHandler);
        });
        
        labelSpan.addEventListener('mouseleave', function(e) {
            const tooltips = document.getElementsByClassName('custom-hover-tooltip');
            for (let i = 0; i < tooltips.length; ++i) {
                tooltips[i].remove();
            }
        });
    }
    // 重新应用搜索高亮,用于节点重新渲染后
    function reapplySearchHighlight(liNode) {
        if (!lastKeyword) return;
        const label = liNode.querySelector(".node-label");
        if (label) {
            const text = label.textContent.trim().toLowerCase();
            if (text.includes(lastKeyword)) {
                liNode.classList.add("highlight");
                // 如果这个 li 在 lastHighlighted 当前索引对应，就加 current-highlight
                if (lastHighlighted[currentSearchIndex] === liNode) {
                    liNode.classList.add("current-highlight");
                }
            }
        }
    }
    // 设置展开图标点击事件
    function setupExpandIconClick(expandIcon, li, nodeData, nodeId, depth, index) {
        expandIcon.addEventListener("click", function (e) {
            e.stopPropagation();
            // 点击关闭右键菜单
            document.getElementById('context-menu-outgoing-node').style.display = 'none';
            document.getElementById('context-menu-blank').style.display = 'none';
            
            // 检查是否处于Show Pins模式
            const isShowPinsMode = sessionStorage.getItem('wall_e_show_pins_only_' + rootId) === 'true';
            console.log("isShowPinsMode:", isShowPinsMode);
            let isExpanded = li.classList.contains("expanded");
            // 检查三角形当前的显示状态
            const isArrowCollapsed = expandIcon.innerHTML.includes('points="5,3 13,8 5,13"');
            
        if (isShowPinsMode) {
            if (isArrowCollapsed) {
                // 展开当前节点及所有后代
                li.classList.add("expanded");
                setArrow(expandIcon, true);
                showAllChildrenOfNode(li);
                // 只恢复路径上的节点 display，不影响子节点三角形和 expanded 状态
                const expandedSet = getExpandedSet();
                expandedSet.add(nodeId);
                saveExpandedSet(expandedSet);
                
                // 记录手动展开的节点（只记录当前节点）
                const manualExpandedSet = getManualExpandedSet();
                manualExpandedSet.add(nodeId);
                saveManualExpandedSet(manualExpandedSet);
                
                // 从手动收缩记录中移除当前节点
                const manualCollapsedSet = getManualCollapsedSet();
                manualCollapsedSet.delete(nodeId);
                saveManualCollapsedSet(manualCollapsedSet);
                
                saveTreeCache(treeData);
                vscode.postMessage({ command: 'EVENT_OUTGOING_GRAPH_EXPAND_NODE' });
            } else {
                // 收缩当前节点及所有后代，只隐藏 display，不改变 expanded 状态和三角形
                li.classList.remove("expanded");
                setArrow(expandIcon, false);
                // 隐藏所有后代节点
                function hideAllDescendants(li) {
                    const childUl = li.querySelector(':scope > ul');
                    if (childUl) {
                        const childLis = childUl.querySelectorAll(':scope > li');
                        childLis.forEach(childLi => {
                            childLi.style.display = 'none';
                            hideAllDescendants(childLi);
                        });
                    }
                }
                hideAllDescendants(li);
                // 父节点本身不隐藏，方便再次展开
                const expandedSet = getExpandedSet();
                expandedSet.delete(nodeId);
                saveExpandedSet(expandedSet);
                
                // 记录手动收缩的节点（只记录当前节点）
                const manualCollapsedSet = getManualCollapsedSet();
                manualCollapsedSet.add(nodeId);
                saveManualCollapsedSet(manualCollapsedSet);
                
                // 从手动展开记录中移除当前节点
                const manualExpandedSet = getManualExpandedSet();
                manualExpandedSet.delete(nodeId);
                saveManualExpandedSet(manualExpandedSet);
                
                saveTreeCache(treeData);
                vscode.postMessage({ command: 'EVENT_OUTGOING_GRAPH_COLLAPSE_NODE' });
            }
            return;
        }
            // 如果不在Show Pins模式，清除标记
            if (isShowPinsMode) {
                sessionStorage.removeItem('wall_e_show_pins_only_' + rootId);
            }
            
            //判断 nodeData.children 的每个 child 是否有 children
            let isSecondToLastLevel = false;
            if (Array.isArray(nodeData.children) && nodeData.children.length > 0) {
                isSecondToLastLevel = nodeData.children.every(child => !child.children || child.children.length === 0);
            }
            
            // 只有层级 >= 5 才允许查找深层次节点
            if (isSecondToLastLevel && depth >= 5) {
                // toggle 展开/收起和深层懒加载逻辑（原有代码）
                isExpanded = li.classList.contains("expanded");
                if (isExpanded) {
                    li.classList.remove("expanded");
                    setArrow(expandIcon, false);
                } else {
                    expandIcon.innerHTML = '<span style="color:#aaa;">⏳</span>';
                    vscode.postMessage({
                        command: "LOAD_OUTGOING_DEEPER",
                        data: {
                            item: nodeData.item,
                            nodeId: nodeId,
                            depth: 5
                        }
                    });
                    vscode.postMessage({ command: 'EVENT_OUTGOING_GRAPH_EXPAND_NODE' });
                    window.addEventListener("message", function handler(ev) {
                        const msg = ev.data;
                        if (msg && msg.command === "OUTGOING_DEEPER_LOADED" && msg.nodeId === nodeId) {
                            if (Array.isArray(msg.children)) {
                                // 更新全局 treeData
                                function updateTreeDataChildren(targetId, nodes) {
                                    for (const node of nodes) {
                                        const id = node.item && node.item._itemId
                                            ? node.item._itemId
                                            : (node.item && node.item.detail ? node.item.detail : '');
                                        if (id === targetId) {
                                            node.children.length = 0;
                                            node.children.push(...msg.children);
                                            return true;
                                        }
                                        if (node.children && node.children.length) {
                                            if (updateTreeDataChildren(targetId, node.children)) return true;
                                        }
                                    }
                                    return false;
                                }
                                updateTreeDataChildren(nodeId, Array.isArray(treeData) ? treeData : [treeData]);

                                nodeData.children.length = 0;
                                nodeData.children.push(...msg.children);
                                // 保存缓存
                                saveTreeCache(treeData);
                                // 重新渲染当前节点
                                const newLi = createTreeNode(nodeData, depth, index);
                                newLi.classList.add("expanded");
                                setArrow(newLi.querySelector('.expand-icon'), true);
                                // 同步展开状态
                                const expandedSet = getExpandedSet();
                                expandedSet.add(nodeId);
                                saveExpandedSet(expandedSet);
                                // 替换旧节点
                                li.parentNode.replaceChild(newLi, li);
                                reapplySearchHighlight(newLi);
                                
                                // 树结构发生变化，刷新搜索结果
                                // refreshSearchIfActive();
                            }
                            window.removeEventListener("message", handler);
                        }
                    });
                }
                // toggle 状态保存
                const expandedSet = getExpandedSet();
                if (li.classList.contains("expanded")) {
                    expandedSet.add(nodeId);
                } else {
                    expandedSet.delete(nodeId);
                }
                saveExpandedSet(expandedSet);
                return;
            }
            
            // 层级小于5时只允许普通展开/收起
            const wasExpanded = li.classList.contains("expanded");
            li.classList.toggle("expanded");
            setArrow(expandIcon, li.classList.contains("expanded"));

            const expandedSet = getExpandedSet();
            const collapsedSet = getCollapsedSet();
            const manualExpandedSet = getManualExpandedSet();
            const manualCollapsedSet = getManualCollapsedSet();
            
            if (li.classList.contains("expanded")) {
                // 展开节点
                expandedSet.add(nodeId);
                collapsedSet.delete(nodeId); // 从折叠记录中移除
                
                // 记录手动展开的节点（只记录当前节点）
                manualExpandedSet.add(nodeId);
                manualCollapsedSet.delete(nodeId); // 从手动收缩记录中移除当前节点
                
                vscode.postMessage({ command: 'EVENT_OUTGOING_GRAPH_EXPAND_NODE' });
            } else {
                // 折叠节点
                expandedSet.delete(nodeId);
                if (wasExpanded) {
                    // 只有当节点之前是展开状态才记录为手动折叠
                    collapsedSet.add(nodeId);
                    
                    // 记录手动收缩的节点（只记录当前节点）
                    manualCollapsedSet.add(nodeId);
                    manualExpandedSet.delete(nodeId); // 从手动展开记录中移除当前节点
                }
                vscode.postMessage({ command: 'EVENT_OUTGOING_GRAPH_COLLAPSE_NODE' });
            }
            
            saveExpandedSet(expandedSet);
            saveCollapsedSet(collapsedSet);
            saveManualExpandedSet(manualExpandedSet);
            saveManualCollapsedSet(manualCollapsedSet);
            saveTreeCache(treeData);
        });
    }

    // ============================================================================
    // 树操作函数
    // ============================================================================
// 展开前N层递归（仿collapseAll风格重写）
// function expandToDepth(root, depthLimit) {
//     // 1. 清空所有展开状态
//     saveExpandedSet(new Set());

//     // 2. 重新渲染树
//     root.innerHTML = "";
//     if (Array.isArray(treeData)) {
//         treeData.forEach((item, idx) => {
//             root.appendChild(createTreeNode(item, 0, idx));
//         });
//     } else {
//         root.appendChild(createTreeNode(treeData, 0, 0));
//     }

//     // 3. 递归展开前N层
//     function expandNode(li, currentDepth, expandedSet) {
//         if (currentDepth > depthLimit) return;
//         if (!li) return;
//         if (li.classList.contains('has-children')) {
//             li.classList.add('expanded');
//             const expandIcon = li.querySelector('.expand-icon');
//             if (expandIcon) {
//                 expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="3,5 8,13 13,5" fill="#4a4a4a"/></svg>';
//             }
//             // 保存展开状态
//             const nodeId = li.__nodeData && li.__nodeData.item && (li.__nodeData.item._itemId || li.__nodeData.item.detail || '');
//             if (nodeId) {
//                 expandedSet.add(nodeId);
//             }
//             // 递归子节点
//             const ul = li.querySelector('ul');
//             if (ul) {
//                 Array.from(ul.children).forEach(childLi => expandNode(childLi, currentDepth + 1, expandedSet));
//             }
//         }
//     }

//     // 4. 展开前N层
//     const expandedSet = getExpandedSet();
//     Array.from(root.children).forEach(li => expandNode(li, 1, expandedSet));
//     saveExpandedSet(expandedSet);

//     // 5. 保存最新 treeData 到缓存
//     saveTreeCache(treeData);

//     // 6. 保存当前展开层级
//     sessionStorage.setItem('wall_e_outgoing_expanded_depth_' + rootId, depthLimit);

//     // 7. 恢复所有已pin节点的蓝色背景
//     setTimeout(() => {
// // // 强制刷新所有节点的展开/收缩状态
//     const allLis = document.querySelectorAll('#tree-root li');
//     allLis.forEach(li => {
//         const depth = getNodeDepth(li); // 你可以实现一个辅助函数
//         if (depth > depthLimit) {
//              li.classList.remove('expanded');
//              const expandIcon = li.querySelector('.expand-icon');
//             if (expandIcon) {
//                 expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="5,3 13,8 5,13" fill="#4a4a4a"/></svg>';
//             }
// //              // 隐藏所有子节点
// //             const ul = li.querySelector(':scope > ul');
// //             if (ul) {
// //                 ul.style.display = 'none';
// //             }
// //         } else {
// //             // 显示本层及子节点
// //             const ul = li.querySelector(':scope > ul');
// //             if (ul) {
// //                 ul.style.display = '';
// //             }
//         }
//     });
// //         // // 恢复所有已pin节点的蓝色背景
// //         // const pinImages = document.querySelectorAll('.node-pin-icon[data-pinned="true"]');
// //         // pinImages.forEach(pinImg => {
// //         //     const li = pinImg.closest('li');
// //         //     if (li) li.classList.add('pinned-node');
// //         // });
//     }, 0);
// }
    // 展开前N层递归
    // function expandToDepth(root, depthLimit) {
    //     const expandedSet = getExpandedSet();
    //     function expandNode(li, currentDepth) {
    //         if (currentDepth > depthLimit) return;
    //         if (!li) return;
    //         if (li.classList.contains('has-children')) {
    //             li.classList.add('expanded');
    //             const expandIcon = li.querySelector('.expand-icon');
    //             if (expandIcon) {
    //                 expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="3,5 8,13 13,5" fill="#4a4a4a"/></svg>';
    //             }
    //             // 保存展开状态
    //             const nodeId = li.__nodeData && li.__nodeData.item && (li.__nodeData.item._itemId || li.__nodeData.item.detail || '');
    //             if (nodeId) {
                    
    //                 expandedSet.add(nodeId);
                    
    //             }
    //             // 递归子节点
    //             const ul = li.querySelector('ul');
    //             if (ul) {
    //                 Array.from(ul.children).forEach(childLi => expandNode(childLi, currentDepth + 1));
    //             }
    //         }
    //     }
    //     Array.from(root.children).forEach(li => expandNode(li, 1));
    //     saveExpandedSet(expandedSet);// <--- 保证所有展开节点都被保存
    //     // 保存最新 treeData 到缓存
    //     saveTreeCache(treeData);
    //     sessionStorage.setItem('wall_e_outgoing_expanded_depth_' + rootId, depthLimit);
    // }

    // 展开前N层递归
    function expandToDepth(root, depthLimit) {
        // 获取当前展开状态集合
        const expandedSet = getExpandedSet();
        
        function expandNode(li, currentDepth) {
            if (currentDepth > depthLimit) return;
            if (!li) return;
            if (li.classList.contains('has-children')) {
                li.classList.add('expanded');
                const expandIcon = li.querySelector('.expand-icon');
                if (expandIcon) {
                    expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="3,5 8,13 13,5" fill="#4a4a4a"/></svg>';
                }
                // 添加到展开状态集合
                const nodeId = li.__nodeData && li.__nodeData.item && (li.__nodeData.item._itemId || li.__nodeData.item.detail || '');
                if (nodeId) {
                    expandedSet.add(nodeId);
                }
                // 递归子节点
                const ul = li.querySelector('ul');
                if (ul) {
                    Array.from(ul.children).forEach(childLi => expandNode(childLi, currentDepth + 1));
                }
            }
        }
        
        // 展开所有节点到指定深度
        Array.from(root.children).forEach(li => expandNode(li, 1));
        
        // 一次性保存所有展开状态
        saveExpandedSet(expandedSet);
        // 保存当前展开深度到 sessionStorage
        sessionStorage.setItem('wall_e_outgoing_expanded_depth_' + rootId, depthLimit);
        // 保存最新 treeData 到缓存
        saveTreeCache(treeData);
    }

    // 折叠记录的手动折叠节点
    function collapseStoredNodes(collapsedSet) {
        const treeRoot = document.getElementById("tree-root");
        const expandedSet = getExpandedSet();
        
        // 递归遍历所有节点，计算正确的depth和index
        function processNode(li, depth, index) {
            if (li.__nodeData) {
                const nodeId = generateUniqueNodeId(li.__nodeData, depth, index);
                
                // 如果这个节点在折叠记录中，就将其折叠
                if (collapsedSet.has(nodeId)) {
                    li.classList.remove('expanded');
                    const expandIcon = li.querySelector('.expand-icon');
                    if (expandIcon) {
                        setArrow(expandIcon, false);
                    }
                    // 从展开集合中移除
                    expandedSet.delete(nodeId);
                }
            }
            
            // 处理子节点
            const ul = li.querySelector(':scope > ul');
            if (ul) {
                const childLis = ul.querySelectorAll(':scope > li');
                childLis.forEach((childLi, childIndex) => {
                    processNode(childLi, depth + 1, childIndex);
                });
            }
        }
        
        // 从根节点开始处理
        const rootLis = treeRoot.querySelectorAll(':scope > li');
        rootLis.forEach((rootLi, rootIndex) => {
            processNode(rootLi, 0, rootIndex);
        });
        
        // 更新展开状态
        saveExpandedSet(expandedSet);
    }

    // 清除搜索高亮但保留搜索框文字
    function clearSearchHighlightOnly() {
        // 清除所有搜索高亮
        lastHighlighted.forEach(li => {
            li.classList.remove("highlight");
            li.classList.remove("current-highlight");
        });
        lastHighlighted = [];
        currentSearchIndex = -1;
        
        // 隐藏搜索结果计数和导航按钮，但保留搜索框文字
        const resultCountEl = document.getElementById("search-result-count");
        const upBtn = document.getElementById("search-up-btn");
        const downBtn = document.getElementById("search-down-btn");
        
        if (resultCountEl) resultCountEl.style.display = "none";
        if (upBtn) upBtn.style.display = "none";
        if (downBtn) downBtn.style.display = "none";
        
        // 不清除 lastKeyword 和搜索框内容，保持搜索框文字
    }

    // 收起所有节点（清空展开缓存并重新渲染树）
    function collapseAll(root) {
        // 清空 expandedSet
        saveExpandedSet(new Set());
        // 保存最新 treeData 到缓存
        saveTreeCache(treeData);
        
        // 重新渲染树
        const treeRoot = document.getElementById("tree-root");
        treeRoot.innerHTML = "";
        if (Array.isArray(treeData)) {
            treeData.forEach((item, idx) => {
                treeRoot.appendChild(createTreeNode(item, 0, idx));
            });
        } else {
            treeRoot.appendChild(createTreeNode(treeData, 0, 0));
        }
        //收起后恢复所有已pin节点的绿色背景
        setTimeout(() => {
            const pinImages = document.querySelectorAll('.node-pin-icon[data-pinned="true"]');
            pinImages.forEach(pinImg => {
                const li = pinImg.closest('li');
                if (li) li.classList.add('pinned-node');
            });
        }, 0);
        // 树结构发生变化，刷新搜索结果
        //refreshSearchIfActive();
    }

    // 获取树的最大深度
    function getMaxDepth(node, cur = 1) {
        if (!node || !node.children || node.children.length === 0) return cur;
        let max = cur;
        for (const child of node.children) {
            max = Math.max(max, getMaxDepth(child, cur + 1));
        }
        return max;
    }

    // ============================================================================
    // 搜索功能
    // ============================================================================

    // 当树结构发生变化时，如果有活跃的搜索，自动重新搜索
    function refreshSearchIfActive() {
        if (lastKeyword && lastKeyword.trim() !== "") {
            console.log("Tree structure changed, refreshing search results for:", lastKeyword);
            triggerSearch();
        }
    }

    // 更新搜索结果显示
    function updateSearchResultDisplay() {
        const resultCountEl = document.getElementById("search-result-count");
        const upBtn = document.getElementById("search-up-btn");
        const downBtn = document.getElementById("search-down-btn");
        
        if (lastHighlighted.length > 0) {
            resultCountEl.textContent = `${currentSearchIndex + 1}/${lastHighlighted.length}`;
            resultCountEl.style.display = "inline";
            if (upBtn) upBtn.style.display = "inline-block";
            if (downBtn) downBtn.style.display = "inline-block";
        } else {
            // resultCountEl.style.display = "none";
            // if (upBtn) upBtn.style.display = "none";
            // if (downBtn) downBtn.style.display = "none";
            resultCountEl.textContent = "0/0";
            resultCountEl.style.display = "inline";
            if (upBtn) upBtn.style.display = "inline-block";
            if (downBtn) downBtn.style.display = "inline-block";
        }
    }

    // 展开父节点
    function expandParentNodes(targetLi) {
        const isShowPinsMode = sessionStorage.getItem('wall_e_show_pins_only_' + rootId) === 'true';
        
        let current = targetLi.parentElement;
        while (current) {
            if (current.tagName === 'UL') {
                const parentLi = current.parentElement;
                if (parentLi && parentLi.tagName === 'LI' && parentLi.classList.contains('has-children')) {
                    parentLi.classList.add('expanded');
                    const expandIcon = parentLi.querySelector('.expand-icon');
                    if (expandIcon ) {
                        // 只有在非Show Pins模式下才更改为实心三角形
                        expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="3,5 8,13 13,5" fill="#4a4a4a"/></svg>';
                    }
                    
                    // 在Show Pins模式下，不调用showAllChildrenOfNode来避免显示不必要的节点
                    if (!isShowPinsMode) {
                        // 显示所有子节点
                        showAllChildrenOfNode(parentLi);
                    }
                    
                    // 保存展开状态
                    const nodeId = parentLi.__nodeData && parentLi.__nodeData.item && (parentLi.__nodeData.item._itemId || parentLi.__nodeData.item.detail || '');
                    if (nodeId) {
                        const expandedSet = getExpandedSet();
                        expandedSet.add(nodeId);
                        saveExpandedSet(expandedSet);
                    }
                }
            }
            current = current.parentElement;
        }
    }

    // 导航到指定的搜索结果
    function navigateToSearchResult(index) {
        if (lastHighlighted.length === 0) return;
        
        // 移除之前的当前高亮
        lastHighlighted.forEach(li => li.classList.remove("current-highlight"));
        
        // 设置新的当前高亮
        const targetLi = lastHighlighted[index];
        if (targetLi) {
            targetLi.classList.add("current-highlight");
            
            // 检查是否处于Show Pins模式
            const isShowPinsMode = sessionStorage.getItem('wall_e_show_pins_only_' + rootId) === 'true';
            
            if (!isShowPinsMode) {
                // 在普通模式下，展开父节点
                expandParentNodes(targetLi);
            }
            // 在Show Pins模式下，不展开父节点，只滚动到目标位置
            
            // 滚动到函数名（node-label）
            setTimeout(() => {
                const label = targetLi.querySelector('.node-label');
                if (label) {
                    label.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    });
                } else {
                    targetLi.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    });
                }
            }, 100);
        }
        
        currentSearchIndex = index;
        updateSearchResultDisplay();
        // 保存当前高亮索引
        sessionStorage.setItem('wall_e_outgoing_search_index_' + rootId, currentSearchIndex);
    }

    // 搜索主函数
    function triggerSearch(restoreIndex) {
        vscode.postMessage({ command: 'EVENT_SEARCH' });
        // 1. 清除之前的高亮
        lastHighlighted.forEach(li => {
            li.classList.remove("highlight");
            li.classList.remove("current-highlight");
        });
        lastHighlighted = [];
        currentSearchIndex = -1;
        
        // 2. 获取搜索关键词
        const input = document.getElementById("searchBox");
        const keyword = input ? input.value.trim().toLowerCase() : "";
        lastKeyword = keyword;
        
        // 3. 检查是否处于Show Pins模式
        const isShowPinsMode = sessionStorage.getItem('wall_e_show_pins_only_' + rootId) === 'true';
        
        // 4. 统计并更新结果数量
        let matchCount = 0;
        const treeRoot = document.getElementById("tree-root");
        const resultCountEl = document.getElementById("search-result-count");
        const upBtn = document.getElementById("search-up-btn");
        const downBtn = document.getElementById("search-down-btn");
        
        if (treeRoot && keyword) {
            const lis = treeRoot.querySelectorAll("li");
            lis.forEach(li => {
                // 检查节点是否在当前DOM中实际可见（考虑Show Pins状态）
                const isCurrentlyVisible = li.style.display !== 'none' && 
                    getComputedStyle(li).display !== 'none';
                
                if (!isCurrentlyVisible) return; // 跳过被隐藏的节点
                
                // 在Show Pins模式下，额外检查是否在pin路径上或是pin节点的展开子节点
                if (isShowPinsMode) {
                    // 检查该节点是否是pin节点或在pin节点的路径上或是pin节点的展开子节点
                    const pinImages = document.querySelectorAll('.node-pin-icon[data-pinned="true"]');
                    let isInPinPath = false;
                    
                    // 检查该节点本身是否是pin节点
                    const currentPinImg = li.querySelector('.node-pin-icon[data-pinned="true"]');
                    if (currentPinImg) {
                        isInPinPath = true;
                    } else {
                        // 检查是否在任何pin节点的路径上（从pin节点到根节点的路径）
                        pinImages.forEach(pinImg => {
                            const pinnedLi = pinImg.closest('li');
                            if (pinnedLi) {
                                const pathToRoot = getPathToRoot(pinnedLi);
                                if (pathToRoot.includes(li)) {
                                    isInPinPath = true;
                                }
                            }
                        });
                        
                        // 如果还没找到，检查是否是pin节点的展开子节点
                        if (!isInPinPath) {
                            pinImages.forEach(pinImg => {
                                const pinnedLi = pinImg.closest('li');
                                if (pinnedLi && isDescendantOf(li, pinnedLi)) {
                                    isInPinPath = true;
                                }
                            });
                        }
                    }
                    
                    if (!isInPinPath) return; // 在Show Pins模式下，跳过不在pin路径上且不是pin子节点的节点
                }
                
                // 判断该节点是否"可见"（所有父节点必须是 expanded）
                let visible = true;
                let parent = li.parentElement;
                while (parent && parent.id !== "tree-root") {
                    if (parent.tagName === "UL") {
                        const pli = parent.parentElement;
                        if (pli && pli.tagName === "LI" && pli.classList.contains("has-children") && !pli.classList.contains("expanded")) {
                            visible = false;
                            break;
                        }
                    }
                    parent = parent.parentElement;
                }
                if (!visible) return; // 跳过未展开的节点

                // 执行匹配
                const label = li.querySelector(".node-label");
                if (label) {
                    const text = label.textContent.trim().toLowerCase();
                    if (text.includes(keyword)) {
                        li.classList.add("highlight");
                        lastHighlighted.push(li);
                        matchCount++;
                    }
                }
            });

            // 只在 restoreIndex 未定义时跳到第一个
            if (matchCount > 0) {
                if (typeof restoreIndex === "number" && !isNaN(restoreIndex) && restoreIndex >= 0 && restoreIndex < lastHighlighted.length) {
                currentSearchIndex = restoreIndex;
                navigateToSearchResult(currentSearchIndex);
            } else {
                currentSearchIndex = 0;
                navigateToSearchResult(0);
            }
            }
            updateSearchResultDisplay();
        } else {
            // 无关键词时隐藏数量提示和导航按钮
            resultCountEl.style.display = "none";
            if (upBtn) upBtn.style.display = "none";
            if (downBtn) downBtn.style.display = "none";
        }
        // 保存搜索框内容和高亮索引
        sessionStorage.setItem('wall_e_outgoing_search_text_' + rootId, keyword);
        sessionStorage.setItem('wall_e_outgoing_search_index_' + rootId, currentSearchIndex);
    }

    // 向上导航
    function searchUp() {
        if (lastHighlighted.length === 0) return;
        let newIndex = currentSearchIndex - 1;
        if (newIndex < 0) newIndex = lastHighlighted.length - 1;
        navigateToSearchResult(newIndex);
    }

    // 向下导航
    function searchDown() {
        if (lastHighlighted.length === 0) return;
        let newIndex = currentSearchIndex + 1;
        if (newIndex >= lastHighlighted.length) newIndex = 0;
        navigateToSearchResult(newIndex);
    }

    // 重置搜索
    function resetSearch() {
        lastHighlighted.forEach(li => {
            li.classList.remove("highlight");
            li.classList.remove("current-highlight");
        });
        lastHighlighted = [];
        lastKeyword = "";
        currentSearchIndex = -1;
        
        const input = document.getElementById("searchBox");
        const resultCountEl = document.getElementById("search-result-count");
        const upBtn = document.getElementById("search-up-btn");
        const downBtn = document.getElementById("search-down-btn");
        
        if (input) input.value = "";
        if (resultCountEl) resultCountEl.style.display = "none";
        if (upBtn) upBtn.style.display = "none";
        if (downBtn) downBtn.style.display = "none";
        vscode.postMessage({ command: 'EVENT_RESET' });
        
        // 清除 sessionStorage 的搜索内容和索引
        sessionStorage.removeItem('wall_e_outgoing_search_text_' + rootId);
        sessionStorage.removeItem('wall_e_outgoing_search_index_' + rootId);
    }

    // ============================================================================
    // 导出功能
    // ============================================================================

    // 导出CSV功能
    function exportCSV() {
        // 递归遍历树，收集节点信息
        function traverse(node, parentName) {
            let rows = [];
            if (node && node.item && node.item.name) {
                const name = node.item.name;
                const file = (node.item.uri && node.item.uri.path) ? node.item.uri.path : "";
                const line = (node.item.selectionRange && node.item.selectionRange[0]) ? (node.item.selectionRange[0].line + 1) : "";
                rows.push([parentName || "", name, file, line]);
            }
            if (node && node.children && node.children.length > 0) {
                for (let i = 0; i < node.children.length; i++) {
                    const child = node.children[i];
                    rows = rows.concat(traverse(child, (node.item && node.item.name) ? node.item.name : parentName));
                }
            }
            return rows;
        }
        
        const tree = loadTreeCache() || treeData;
        let rows = [["Parent", "Function", "File", "Line"]];
        if (Array.isArray(tree)) {
            for (let i = 0; i < tree.length; i++) {
                rows = rows.concat(traverse(tree[i], ""));
            }
        } else {
            rows = rows.concat(traverse(tree, ""));
        }
        
        // 拼接为 CSV 字符串
        const csvString = rows.map(function(row) {
            return row.map(function(v) {
                return '"' + String(v).replace(/"/g, '""') + '"';
            }).join(",");
        }).join(",");
        
        vscode.postMessage({ command: 'EVENT_EXPORT_CSV', csv: csvString });
    }

    // SVG测量和渲染函数
    function measureNode(node, padding, labelHeight, childHeight, childGap) {
        // label宽度自适应，最小宽度 80
        const labelText = node.item ? getShortName(node.item) : '';
        const labelWidth = Math.max(80, 9 * labelText.length + 20); // 每字符9px+左右边距，最小80
        let width = labelWidth + padding * 2;
        let height = labelHeight + padding * 2;
        
        if (node.children && node.children.length > 0) {
            const childSizes = node.children.map(function(c) { return measureNode(c, padding, labelHeight, childHeight, childGap); });
            const childWidth = Math.max.apply(null, childSizes.map(function(s) { return s.width; }));
            const childHeightSum = childSizes.reduce(function(sum, s) { return sum + s.height; }, 0) + (node.children.length - 1) * childGap;
            // 父框宽度包裹所有子节点
            width = Math.max(width, childWidth + padding * 2);
            // 父框高度 = label高度 + 子节点总高度 + padding
            height = labelHeight + padding * 2 + childHeightSum;
            node._childSizes = childSizes;
        }
        node._size = { width: width, height: height };
        return node._size;
    }

    function renderNestedSVG(node, depth, x, y, width, padding, labelHeight, childHeight, childGap) {
        const label = node.item ? escapeXML(getShortName(node.item)) : '';
        const nodeW = node._size ? node._size.width : width;
        const nodeH = node._size ? node._size.height : (labelHeight + padding * 2);
        const rect = '<rect x="' + x + '" y="' + y + '" width="' + nodeW + '" height="' + nodeH + '" rx="12" fill="#fafafa" stroke="#aaa"/>';
        const text = '<text x="' + (x + 16) + '" y="' + (y + padding + labelHeight - 8) + '" font-size="15" fill="#333" font-family="Consolas,monospace">' + label + '</text>';
        let content = rect + text;
        
        if (node.children && node.children.length > 0 && node._childSizes) {
            const childX = x + padding;
            let childY = y + labelHeight + padding;
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const childSize = node._childSizes[i];
                content += '<g>' + renderNestedSVG(child, depth + 1, childX, childY, childSize.width, padding, labelHeight, childHeight, childGap) + '</g>';
                childY += childSize.height + childGap;
            }
        }
        return content;
    }

    // 导出SVG功能
    async function exportSVG() {
        // 参数
        const tree = loadTreeCache() || treeData;
        const padding = 16;
        const labelHeight = 18;
        const childHeight = 18;
        const childGap = 16;
        
        // 递归计算所有节点尺寸
        measureNode(tree, padding, labelHeight, childHeight, childGap);
        const svgW = tree._size.width + padding * 2;
        const svgH = tree._size.height + padding * 2;
        const svgContent = renderNestedSVG(tree, 0, padding, padding, tree._size.width, padding, labelHeight, childHeight, childGap);
        const style = '<style>.node-rect { filter: drop-shadow(0 1px 3px rgba(0,0,0,0.05)); transition: fill 0.3s, stroke 0.3s; } .node-label { font-family: Consolas, monospace; font-weight: 500; pointer-events: none; } .node-link { stroke: #ddd; stroke-width: 2; }</style>';
        const svgString = '<?xml version="1.0" encoding="UTF-8"?>'
            + '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgW + '" height="' + svgH + '" viewBox="0 0 ' + svgW + ' ' + svgH + '">' + style + svgContent + '</svg>';
        
        vscode.postMessage({
            command: 'EVENT_EXPORT_SVG',
            svg: svgString
        });
    }

    // ============================================================================
    // 右键菜单功能
    // ============================================================================

    // 右键菜单事件处理
    function setupContextMenu() {
        const contextMenuOutgoingNode = document.getElementById('context-menu-outgoing-node');
        const contextMenuBlank = document.getElementById('context-menu-blank');
        const treeRoot = document.getElementById("tree-root");
        
        // 右键菜单生成
        document.addEventListener('contextmenu', function(e) {
            // 节点右键
            if ((e.target && e.target.classList.contains('node-label')) || (e.target && e.target.tagName === 'LI')) {
                e.preventDefault();
                const liNode = e.target.tagName === 'LI' ? e.target : e.target.parentElement;
                contextMenuOutgoingNode.style.display = 'block';
                contextMenuOutgoingNode.style.left = e.pageX + 'px';
                contextMenuOutgoingNode.style.top = e.pageY + 'px';
                lastRightClickNodeData = liNode && liNode.__nodeData ? liNode.__nodeData : null;
                contextMenuBlank.style.display = 'none';
                return;
            }
            // 空白区域右键
            if (e.target === document.body || e.target === treeRoot || e.target.tagName === 'HTML') {
                e.preventDefault();
                contextMenuBlank.style.display = 'block';
                contextMenuBlank.style.left = e.pageX + 'px';
                contextMenuBlank.style.top = e.pageY + 'px';
                contextMenuOutgoingNode.style.display = 'none';
                return;
            }
            // 其他区域右键，关闭所有菜单
            e.preventDefault();
            contextMenuOutgoingNode.style.display = 'none';
            contextMenuBlank.style.display = 'none';
        });

        // 右键菜单项事件绑定
        contextMenuOutgoingNode.querySelector('[data-action="EVENT_OUTGOING_REGENERATE"]').addEventListener('click', function(e) {
            contextMenuOutgoingNode.style.display = 'none';
            if (lastRightClickNodeData && lastRightClickNodeData.item) {
                vscode.postMessage({
                    command: 'EVENT_OUTGOING_REGENERATE',
                    data: { item: lastRightClickNodeData.item }
                });
            }
        });

        // 添加右键菜单导出SVG事件监听器
        contextMenuOutgoingNode.querySelector('[data-action="EVENT_EXPORT_SVG"]').addEventListener('click', function(e) {
            contextMenuOutgoingNode.style.display = 'none';
            exportSVG();
        });

        // 添加右键菜单导出CSV事件监听器
        contextMenuOutgoingNode.querySelector('[data-action="EVENT_EXPORT_CSV"]').addEventListener('click', function(e) {
            contextMenuOutgoingNode.style.display = 'none';
            exportCSV();
        });

        // 菜单项点击
        document.getElementById('export-svg').addEventListener('click', function(e) {
            contextMenuBlank.style.display = 'none';
            exportSVG();
        });

        // 导出 CSV 菜单项点击
        document.getElementById('export-csv').addEventListener('click', function(e) {
            exportCSV();
        });
    }

    // ============================================================================
    // Pin按钮状态管理
    // ============================================================================

    // 检查是否有pinned节点
    function hasPinnedNodes() {
        const pinKey = 'wall_e_pinned_nodes_' + rootId;
        const pinnedNodes = JSON.parse(sessionStorage.getItem(pinKey) || '{}');
        return Object.values(pinnedNodes).some(isPinned => isPinned === true);
    }

    // 更新Pin相关按钮的状态
    function updatePinButtonsState() {
        const showPinsBtn = document.getElementById('show-pins-btn');
        const resetPinsBtn = document.getElementById('reset-pins-btn');
        const hasPinned = hasPinnedNodes();
        
        if (showPinsBtn) {
            showPinsBtn.disabled = !hasPinned;
        }
        if (resetPinsBtn) {
            resetPinsBtn.disabled = !hasPinned;
        }
    }

    // ============================================================================
    // 事件绑定和初始化
    // ============================================================================

    // 全局点击事件，清除高亮和菜单
    document.addEventListener("click", function() {
        clearNodeHighlightAndMenus();
        // 清除保存的高亮节点ID
        sessionStorage.removeItem('wall_e_outgoing_highlight_' + rootId);
    });

    // 按钮事件绑定
    function setupButtonEvents() {
        const treeRoot = document.getElementById("tree-root");
        
        // 展开5层按钮
            document.getElementById('expand-5').addEventListener('click', function() {
                // 清除Show Pins模式
                sessionStorage.removeItem('wall_e_show_pins_only_' + rootId);
                // 清空手动展开/收缩的记录
                saveManualExpandedSet(new Set());
                saveManualCollapsedSet(new Set());
                
                collapseAll(treeRoot);
                expandToDepth(treeRoot, 5);
                // 展开全部时 showlevel 设为 5
                const select = document.getElementById('select-depth');
                if (select) select.value = '5';
                // 清除搜索高亮但保留搜索框文字
                clearSearchHighlightOnly();
                vscode.postMessage({ command: 'EVENT_OUTGOING_GRAPH_EXPAND_ALL' });
                 // 清除 sessionStorage 的搜索内容和索引
                sessionStorage.removeItem('wall_e_outgoing_search_text_' + rootId);
                sessionStorage.removeItem('wall_e_outgoing_search_index_' + rootId);
                // 清除选择器设置标记，因为这是通过按钮操作的
                sessionStorage.removeItem('wall_e_outgoing_depth_set_by_selector_' + rootId);
            });
        
        // 收起所有按钮
            document.getElementById('collapse-all').addEventListener('click', function() {
                // 清除Show Pins模式
                sessionStorage.removeItem('wall_e_show_pins_only_' + rootId);
                // 清空手动展开/收缩的记录
                saveManualExpandedSet(new Set());
                saveManualCollapsedSet(new Set());
                
                collapseAll(treeRoot);
                // 收起全部时 showlevel 设为 1
                const select = document.getElementById('select-depth');
                if (select) select.value = '1';
                // 清除搜索高亮但保留搜索框文字
                clearSearchHighlightOnly();
                vscode.postMessage({ command: 'EVENT_OUTGOING_GRAPH_COLLAPSE_ALL' });
                 // 清除 sessionStorage 的搜索内容和索引
                sessionStorage.removeItem('wall_e_outgoing_search_text_' + rootId);
                sessionStorage.removeItem('wall_e_outgoing_search_index_' + rootId);
                // 清除选择器设置标记，因为这是通过按钮操作的
                sessionStorage.removeItem('wall_e_outgoing_depth_set_by_selector_' + rootId);
                // 重要：清除保存的展开深度，并设置为1层
                sessionStorage.setItem('wall_e_outgoing_expanded_depth_' + rootId, '1');
                // 标记这是通过按钮操作设置的，确保页面恢复时应用正确的状态
                sessionStorage.setItem('wall_e_outgoing_depth_set_by_selector_' + rootId, 'true');
            });
        
        // 层级选择器
        document.getElementById('select-depth').addEventListener('change', function(e) {
            const val = parseInt(e.target.value, 10);
            console.log("Selected depth:", val);
            
            // 清除Show Pins模式
            sessionStorage.removeItem('wall_e_show_pins_only_' + rootId);
            
            // 清空手动展开/收缩的记录
            saveManualExpandedSet(new Set());
            saveManualCollapsedSet(new Set());
            
            // 清空手动折叠节点记录（这是关键！）
            saveCollapsedSet(new Set());
            
            // 先收起所有节点，再展开指定层级
            collapseAll(treeRoot);
            expandToDepth(treeRoot, val);
            // 清除搜索高亮但保留搜索框文字
            clearSearchHighlightOnly();
            vscode.postMessage({ command: 'EVENT_OUTGOING_GRAPH_SELECT_DEPTH' });
             // 清除 sessionStorage 的搜索内容和索引
            sessionStorage.removeItem('wall_e_outgoing_search_text_' + rootId);
            sessionStorage.removeItem('wall_e_outgoing_search_index_' + rootId);
            // 保存当前层级到 sessionStorage，并标记这是通过层级选择器设置的
            sessionStorage.setItem('wall_e_outgoing_expanded_depth_' + rootId, val);
            sessionStorage.setItem('wall_e_outgoing_depth_set_by_selector_' + rootId, 'true');
        });
        document.getElementById('reset-pins-btn').addEventListener('click', function() {
            // 清除搜索高亮但保留搜索框文字
            clearSearchHighlightOnly(); 
            // Clear pin states from sessionStorage
            const pinKey = 'wall_e_pinned_nodes_' + rootId;
            sessionStorage.removeItem(pinKey);
             // Find all pin images and reset them
            const pinImages = document.querySelectorAll('.node-pin-icon');
            pinImages.forEach(pinImg => {
            pinImg.src = pinImageUri; // Reset to empty pin
            pinImg.setAttribute('data-pinned', 'false');
            pinImg.style.display = "none"; // Hide the pin icon after reset
            
            // Remove green background from the node
            const li = pinImg.closest('li');
            if (li) li.classList.remove('pinned-node');
            });
            
            // Update button states after clearing pins
            updatePinButtonsState();
             // 清除 sessionStorage 的搜索内容和索引
            sessionStorage.removeItem('wall_e_outgoing_search_text_' + rootId);
            sessionStorage.removeItem('wall_e_outgoing_search_index_' + rootId);
        });
        // Show Pins button
        document.getElementById('show-pins-btn').addEventListener('click', function() {
            // 清除搜索高亮但保留搜索框文字
            clearSearchHighlightOnly(); 
            
            // 清空手动展开/收缩的记录
            saveManualExpandedSet(new Set());
            saveManualCollapsedSet(new Set());
            
            showPinsOnly();
             // 清除 sessionStorage 的搜索内容和索引
            sessionStorage.removeItem('wall_e_outgoing_search_text_' + rootId);
            sessionStorage.removeItem('wall_e_outgoing_search_index_' + rootId);
});
    }

    // 搜索事件绑定
    function setupSearchEvents() {
        const btn = document.getElementById("searchBtn");
        const input = document.getElementById("searchBox");
        const upBtn = document.getElementById("search-up-btn");
        const downBtn = document.getElementById("search-down-btn");
        const resetBtn = document.getElementById("resetBtn");
        
        if (btn) {
            btn.addEventListener("click", triggerSearch);
        }
        
        if (input) {
            input.addEventListener("keydown", function(e) {
                if (e.key === "Enter") {
                    triggerSearch();
                }
            });
            // 监听输入框内容变化，如果清空则清除高亮
            input.addEventListener("input", function(e) {
                const currentValue = e.target.value.trim();
                // 如果搜索框被清空，清除搜索高亮
                if (currentValue === "") {
                    clearSearchHighlightOnly();
                }
            });

        }
        
        // 导航按钮事件
        if (upBtn) {
            upBtn.addEventListener("click", searchUp);
        }
        if (downBtn) {
            downBtn.addEventListener("click", searchDown);
        }
        
        // resetBtn 恢复普通样式
        if (resetBtn) {
            resetBtn.addEventListener("click", resetSearch);
        }
    }

    // 初始化层级选择器
    function setupDepthSelector() {
        let maxLevel = 1;
        if (Array.isArray(treeData)) {
            maxLevel = Math.max(...treeData.map(item => getMaxDepth(item)));
        } else {
            maxLevel = getMaxDepth(treeData);
        }
        // 确保当没有子节点时，至少显示1层选项
        maxLevel = Math.max(1, Math.min(maxLevel - 1, 5));
        
        const select = document.getElementById('select-depth');
        select.innerHTML = '';
        for (let i = 1; i <= maxLevel; ++i) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = i + (i === 1 ? ' Level' : ' Level');
            if (i === 1) opt.selected = true;
            select.appendChild(opt);
        }
    }

    // 初始化树渲染
    function initializeTree() {
        const treeRoot = document.getElementById("tree-root");
        let renderTree = loadTreeCache();
        
        // 清空现有树内容
        treeRoot.innerHTML = "";
        
        // 渲染树结构
        if (renderTree) {
            // 用缓存渲染，并同步 treeData 指针，保证后续懒加载写入的也是缓存对象
            if (Array.isArray(renderTree)) {
                treeData.length = 0;
                renderTree.forEach(item => treeData.push(item));
                renderTree.forEach((item, idx) => {
                    treeRoot.appendChild(createTreeNode(item, 0, idx));
                });
            } else {
                Object.assign(treeData, renderTree);
                treeRoot.appendChild(createTreeNode(renderTree, 0, 0));
            }
        } else {
            // 首次渲染，保存到缓存
            if (Array.isArray(treeData)) {
                treeData.forEach((item, idx) => {
                    treeRoot.appendChild(createTreeNode(item, 0, idx));
                });
            } else {
                treeRoot.appendChild(createTreeNode(treeData, 0, 0));
            }
            saveTreeCache(treeData);
        }
        
        // 恢复展开状态和其他UI状态
        setTimeout(() => {
            // 检查是否有保存的展开深度
            const expandedDepth = parseInt(sessionStorage.getItem('wall_e_outgoing_expanded_depth_' + rootId), 10);
            const collapsedSet = getCollapsedSet();
            
            if (!isNaN(expandedDepth)) {
                // 先按照层级选择器展开
                expandToDepth(treeRoot, expandedDepth);
                
                // 然后再折叠记录的手动折叠节点
                if (collapsedSet.size > 0) {
                    collapseStoredNodes(collapsedSet);
                }
                
                // 更新层级选择器
                const select = document.getElementById('select-depth');
                if (select) select.value = String(expandedDepth);
            }
            
            // 调用简化的状态恢复，不再重新应用展开逻辑
            restoreOtherStates(treeRoot);
        }, 10);
    }

    // 恢复手动展开/收缩节点状态
    function restoreManualNodeStates() {
        const treeRoot = document.getElementById("tree-root");
        const manualExpandedSet = getManualExpandedSet();
        const manualCollapsedSet = getManualCollapsedSet();
        const expandedSet = getExpandedSet();
        const isShowPinsMode = sessionStorage.getItem('wall_e_show_pins_only_' + rootId) === 'true';
        
        // 递归遍历所有节点，计算正确的depth和index
        function processNode(li, depth, index) {
            if (li.__nodeData) {
                const nodeId = generateUniqueNodeId(li.__nodeData, depth, index);
                
                // 检查是否有手动展开记录
                if (manualExpandedSet.has(nodeId)) {
                    li.classList.add('expanded');
                    const expandIcon = li.querySelector('.expand-icon');
                    if (expandIcon) {
                        setArrow(expandIcon, true);
                    }
                    expandedSet.add(nodeId);
                    
                    // 在Show Pins模式下，需要显示子节点
                    if (isShowPinsMode) {
                        showAllChildrenOfNode(li);
                    }
                }
                
                // 检查是否有手动收缩记录
                if (manualCollapsedSet.has(nodeId)) {
                    li.classList.remove('expanded');
                    const expandIcon = li.querySelector('.expand-icon');
                    if (expandIcon) {
                        setArrow(expandIcon, false);
                    }
                    expandedSet.delete(nodeId);
                    
                    // 在Show Pins模式下，需要隐藏子节点
                    if (isShowPinsMode) {
                        function hideAllDescendants(li) {
                            const childUl = li.querySelector(':scope > ul');
                            if (childUl) {
                                const childLis = childUl.querySelectorAll(':scope > li');
                                childLis.forEach(childLi => {
                                    childLi.style.display = 'none';
                                    hideAllDescendants(childLi);
                                });
                            }
                        }
                        hideAllDescendants(li);
                    }
                }
            }
            
            // 处理子节点
            const ul = li.querySelector(':scope > ul');
            if (ul) {
                const childLis = ul.querySelectorAll(':scope > li');
                childLis.forEach((childLi, childIndex) => {
                    processNode(childLi, depth + 1, childIndex);
                });
            }
        }
        
        // 从根节点开始处理
        const rootLis = treeRoot.querySelectorAll(':scope > li');
        rootLis.forEach((rootLi, rootIndex) => {
            processNode(rootLi, 0, rootIndex);
        });
        
        // 更新展开状态
        saveExpandedSet(expandedSet);
    }

    // 恢复其他状态（不包括展开/折叠逻辑）
    function restoreOtherStates(treeRoot) {
        // 1. 恢复Pin状态和背景色
        const pinImages = document.querySelectorAll('.node-pin-icon[data-pinned="true"]');
        pinImages.forEach(pinImg => {
            const li = pinImg.closest('li');
            if (li) li.classList.add('pinned-node');
        });

        // 2. 恢复高亮节点
        const highlightId = sessionStorage.getItem('wall_e_outgoing_highlight_' + rootId);
        if (highlightId) {
            const allLis = treeRoot.querySelectorAll('li');
            allLis.forEach(li => {
                if (li.__nodeData) {
                    const nodeId = generateUniqueNodeId(li.__nodeData, li.__depth || 0, li.__index || 0);
                    if (nodeId === highlightId) {
                        li.classList.add('node-highlight');
                    }
                }
            });
        }

        // 3. 恢复搜索状态
        restoreSearchState();

        // 4. 恢复Show Pins模式状态
        if (sessionStorage.getItem('wall_e_show_pins_only_' + rootId) === 'true') {
            restoreShowPinsMode();
            // 在Show Pins模式下，也要恢复手动展开/收缩的节点状态
            restoreManualNodeStates();
        } else {
            // 5. 如果不在Show Pins模式，恢复手动展开/收缩的节点状态
            restoreManualNodeStates();
        }

        // 6. 更新Pin按钮状态
        updatePinButtonsState();
    }

    // 恢复其他状态（不包括手动折叠状态恢复）- 用于层级选择器恢复时
    function restoreOtherStatesWithoutManual(treeRoot) {
        // 1. 恢复Pin状态和背景色
        const pinImages = document.querySelectorAll('.node-pin-icon[data-pinned="true"]');
        pinImages.forEach(pinImg => {
            const li = pinImg.closest('li');
            if (li) li.classList.add('pinned-node');
        });

        // 2. 恢复高亮节点
        const highlightId = sessionStorage.getItem('wall_e_outgoing_highlight_' + rootId);
        if (highlightId) {
            const allLis = treeRoot.querySelectorAll('li');
            allLis.forEach(li => {
                if (li.__nodeData) {
                    const nodeId = generateUniqueNodeId(li.__nodeData, li.__depth || 0, li.__index || 0);
                    if (nodeId === highlightId) {
                        li.classList.add('node-highlight');
                    }
                }
            });
        }

        // 3. 恢复搜索状态
        restoreSearchState();

        // 4. 恢复Show Pins模式状态（但不恢复手动折叠状态）
        if (sessionStorage.getItem('wall_e_show_pins_only_' + rootId) === 'true') {
            restoreShowPinsMode();
        }

        // 5. 更新Pin按钮状态
        updatePinButtonsState();
    }

    // // 恢复所有状态的统一函数（保留以备其他地方使用）
    // function restoreAllStates(treeRoot) {
    //     // 1. 检查是否有用户手动展开的状态
    //     const expandedSet = getExpandedSet();
    //     const hasManualExpansion = expandedSet.size > 0;
        
    //     // 2. 检查层级选择器设置的深度
    //     const expandedDepth = parseInt(sessionStorage.getItem('wall_e_outgoing_expanded_depth_' + rootId), 10);
    //     const isDepthSetBySelector = sessionStorage.getItem('wall_e_outgoing_depth_set_by_selector_' + rootId) === 'true';
        
    //     // 3. 恢复层级选择器状态
    //     if (!isNaN(expandedDepth)) {
    //         const select = document.getElementById('select-depth');
    //         if (select) select.value = String(expandedDepth);
    //     }
        
    //     // 4. 决定恢复策略：如果有手动展开状态且不是刚通过选择器设置的，优先恢复手动状态
    //     if (hasManualExpansion && !isDepthSetBySelector) {
    //         // 恢复用户手动展开的状态，不重新应用层级深度
    //         console.log("Restoring manual expansion state");
    //     } else if (!isNaN(expandedDepth) && isDepthSetBySelector) {
    //         // 如果是通过层级选择器设置的，重新应用层级深度
    //         console.log("Restoring depth selector state");
    //         const currentExpandedSet = new Set();
    //         saveExpandedSet(currentExpandedSet);
    //         expandToDepth(treeRoot, expandedDepth);
    //         // 清除选择器设置标记，避免重复应用
    //         sessionStorage.removeItem('wall_e_outgoing_depth_set_by_selector_' + rootId);
    //     }

    //     // 调用其他状态恢复
    //     restoreOtherStates(treeRoot);
    // }

    // 恢复搜索状态
    function restoreSearchState() {
        const searchText = sessionStorage.getItem('wall_e_outgoing_search_text_' + rootId) || "";
        const searchBox = document.getElementById("searchBox");
        if (searchBox) searchBox.value = searchText;
        lastKeyword = searchText.trim().toLowerCase();

        if (lastKeyword) {
            const savedIndex = parseInt(sessionStorage.getItem('wall_e_outgoing_search_index_' + rootId), 10);
            triggerSearch(isNaN(savedIndex) ? 0 : savedIndex);
        }
    }

    // 恢复Show Pins模式状态
    function restoreShowPinsMode() {
        const allNodes = document.querySelectorAll('#tree-root li');
        const pinImages = document.querySelectorAll('.node-pin-icon[data-pinned="true"]');
        
        if (pinImages.length === 0) {
            // 如果没有Pin节点了，退出Show Pins模式
            sessionStorage.removeItem('wall_e_show_pins_only_' + rootId);
            return;
        }

        // 收集所有需要显示的节点路径
        const visibleNodes = new Set();
        const pinLis = [];
        
        pinImages.forEach(pinImg => {
            const pinnedLi = pinImg.closest('li');
            if (pinnedLi) {
                pinLis.push(pinnedLi);
                const pathToRoot = getPathToRoot(pinnedLi);
                pathToRoot.forEach(node => visibleNodes.add(node));
            }
        });

        // 恢复显示状态
        allNodes.forEach(li => {
            if (visibleNodes.has(li)) {
                li.style.display = 'block';
            } else {
                li.style.display = 'none';
            }
        });

        // 恢复展开图标状态
        const expandedSet = getExpandedSet();
        const manualExpandedSet = getManualExpandedSet();
        const manualCollapsedSet = getManualCollapsedSet();
        
        visibleNodes.forEach(li => {
            if (li.classList.contains('has-children')) {
                const expandIcon = li.querySelector('.expand-icon');
                const isPinned = pinLis.includes(li);
                const nodeId = getNodeId(li);
                
                // 检查是否有手动展开/收缩记录
                const isManuallyExpanded = manualExpandedSet.has(nodeId);
                const isManuallyCollapsed = manualCollapsedSet.has(nodeId);
                
                if (isPinned && !hasVisibleChildren(li, visibleNodes)) {
                    // Pin的末节点：根据手动操作记录决定状态
                    if (isManuallyExpanded) {
                        // 手动展开过的Pin末节点：空心展开三角形
                        if (expandIcon) {
                            expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="3,5 8,13 13,5" fill="none" stroke="#4a4a4a" stroke-width="2"/></svg>';
                        }
                        li.classList.add('expanded');
                    } else {
                        // 默认或手动收缩的Pin末节点：实心收缩三角形
                        if (expandIcon) {
                            expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="5,3 13,8 5,13" fill="#4a4a4a"/></svg>';
                        }
                        li.classList.remove('expanded');
                    }
                } else if (expandedSet.has(nodeId)) {
                    // 路径上的节点：根据手动操作记录决定状态
                    if (isManuallyCollapsed) {
                        // 手动收缩过的路径节点：实心收缩三角形
                        if (expandIcon) {
                            expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="5,3 13,8 5,13" fill="#4a4a4a"/></svg>';
                        }
                        li.classList.remove('expanded');
                    } else {
                        // 默认或手动展开的路径节点：空心展开三角形
                        if (expandIcon) {
                            expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="3,5 8,13 13,5" fill="none" stroke="#4a4a4a" stroke-width="2"/></svg>';
                        }
                        li.classList.add('expanded');
                    }
                }
            }
        });
    }

    // 辅助函数：检查节点是否有可见的子节点
    function hasVisibleChildren(li, visibleNodes) {
        const childUl = li.querySelector(':scope > ul');
        if (!childUl) return false;
        
        const childLis = Array.from(childUl.querySelectorAll(':scope > li'));
        return childLis.some(childLi => visibleNodes.has(childLi));
    }

    // 辅助函数：获取节点ID
    function getNodeId(li) {
        return li.__nodeData && li.__nodeData.item && (li.__nodeData.item._itemId || li.__nodeData.item.detail || '');
    }
        // 保存pin状态
    function savePinState(nodeId, isPinned) {
        const pinKey = 'wall_e_pinned_nodes_' + rootId;
        const pinnedNodes = JSON.parse(sessionStorage.getItem(pinKey) || '{}');
        pinnedNodes[nodeId] = isPinned;
        sessionStorage.setItem(pinKey, JSON.stringify(pinnedNodes));
        
        // 更新按钮状态
        updatePinButtonsState();
    }

    // 恢复pin状态
    function restorePinState(nodeId, pinImg) {
        const pinKey = 'wall_e_pinned_nodes_' + rootId;
        const pinnedNodes = JSON.parse(sessionStorage.getItem(pinKey) || '{}');
        const isPinned = pinnedNodes[nodeId] || false;
        
        // 获取对应的li元素
        const li = pinImg.closest('li');
        
        if (isPinned) {
            pinImg.src = pinFillImageUri;
            pinImg.setAttribute('data-pinned', 'true');
            pinImg.style.display = "inline"; // 已pin的节点始终显示
            if (li) {
                li.classList.add('pinned-node'); // 添加绿色背景样式
            }
        } else {
            pinImg.src = pinImageUri;
            pinImg.setAttribute('data-pinned', 'false');
            if (li) {
                li.classList.remove('pinned-node'); // 移除绿色背景样式
            }
            // pinImg.style.display = "none"; // 保持初始隐藏状态，由css控制
        }
    }
    
    // Trace Path to Root
    function getPathToRoot(targetLi) {
    const path = [];
    let current = targetLi;
    
    while (current && current.tagName === 'LI') {
        path.unshift(current); // Add to beginning of array
        const parentUl = current.parentElement;
        if (parentUl && parentUl.tagName === 'UL') {
            current = parentUl.parentElement; // Get parent LI
        } else {
            break;
        }
    }
    
    return path;
    }

    // 检查一个节点是否是另一个节点的子节点
    function isDescendantOf(childNode, parentNode) {
        let current = childNode.parentElement;
        
        while (current) {
            if (current.tagName === 'UL') {
                const parentLi = current.parentElement;
                if (parentLi === parentNode) {
                    return true;
                }
                current = parentLi ? parentLi.parentElement : null;
            } else {
                current = current.parentElement;
            }
        }
        
        return false;
    }
    

   

    
    function showPinsOnly() {
    // 获取所有已pin节点
    const pinImages = document.querySelectorAll('.node-pin-icon[data-pinned="true"]');
    if (pinImages.length === 0) {
        alert('No pins found. Please pin some nodes first.');
        return;
    }

    // 收集所有需要显示的节点（根到每个pin节点的路径）
    const visibleNodes = new Set();
    const pinLis = [];
    pinImages.forEach(pinImg => {
        const pinnedLi = pinImg.closest('li');
        if (pinnedLi) {
            pinLis.push(pinnedLi);
            const pathToRoot = getPathToRoot(pinnedLi);
            pathToRoot.forEach(node => visibleNodes.add(node));
        }
    });

    // 隐藏所有不在visibleNodes集合中的节点
    const allNodes = document.querySelectorAll('#tree-root li');
    allNodes.forEach(li => {
        if (visibleNodes.has(li)) {
            li.style.display = 'block';
        } else {
            li.style.display = 'none';
        }
    });

    // 展开路径上的所有节点，但三角形保持收缩状态
    const expandedSet = new Set();
    visibleNodes.forEach(li => {
        if (li.classList.contains('has-children')) {
        
            // li.classList.add('expanded');
            // const expandIcon = li.querySelector('.expand-icon');
            
            // 判断是否为pin的末节点：必须是pin节点，且其所有子节点都不在visibleNodes中
            const isPinned = pinLis.includes(li);
            let isPinEndNode = false;
            
            if (isPinned) {
                const childUl = li.querySelector(':scope > ul');
                if (childUl) {
                    const childLis = Array.from(childUl.querySelectorAll(':scope > li'));
                    // 如果所有子节点都不在visibleNodes中，说明这是末节点
                    isPinEndNode = childLis.length === 0 || childLis.every(childLi => !visibleNodes.has(childLi));
                } else {
                    // 没有子节点，也是末节点
                    isPinEndNode = true;
                }
            }
            const expandIcon = li.querySelector('.expand-icon');
            if (expandIcon) {
                if (isPinEndNode) {
                    // 实心收缩三角形（向右），不加 expanded 类
                    expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="5,3 13,8 5,13" fill="#4a4a4a"/></svg>';
                    li.classList.remove('expanded'); // <-- 这里移除 expanded
                } else {
                    // 空心展开三角形（向下），加 expanded 类
                    expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="3,5 8,13 13,5" fill="none" stroke="#4a4a4a" stroke-width="2"/></svg>';
                    li.classList.add('expanded');
                }
            }
            const nodeId = li.__nodeData && li.__nodeData.item && (li.__nodeData.item._itemId || li.__nodeData.item.detail || '');
            if (nodeId && !isPinEndNode) expandedSet.add(nodeId);
        }
    });
    saveExpandedSet(expandedSet);

    // 可选：保存 pin-only 状态
    sessionStorage.setItem('wall_e_show_pins_only_' + rootId, 'true');
}
   

    
// 显示某个节点下面的所有子节点
function showAllChildrenOfNode(parentLi) {
    // 获取所有已pin节点
    const pinImages = document.querySelectorAll('.node-pin-icon[data-pinned="true"]');
    const pinnedLis = Array.from(pinImages).map(pinImg => pinImg.closest('li'));
    const pinnedSet = new Set(pinnedLis);

    // 判断 li 是否是空心展开三角形
    function isHollowExpandTriangle(li) {
        const expandIcon = li.querySelector('.expand-icon');
        if (!expandIcon) return false;
        // 空心展开三角形：向下，fill="none"
        return expandIcon.innerHTML.includes('points="3,5 8,13 13,5"') && expandIcon.innerHTML.includes('fill="none"');
    }

    // 递归显示所有子节点
    function showAllDescendants(li) {
        let hollowExpandHasDescendants = false;
        li.style.display = 'block';

        const childUl = li.querySelector(':scope > ul');
        if (childUl) {
            const childLis = childUl.querySelectorAll(':scope > li');
            childLis.forEach(childLi => {
                if (isHollowExpandTriangle(li)) {
                    // 只展示pin路径
                    if (pinnedSet.has(childLi)) {
                        showAllDescendants(childLi);
                        hollowExpandHasDescendants=true;
                    }
                } else {
                    showAllDescendants(childLi);
                }
            });
        }
        if(!hollowExpandHasDescendants && isHollowExpandTriangle(li)){
            // 如果是空心展开三角形但没有子节点在pin路径上，变成实心收缩三角形
            const expandIcon = li.querySelector('.expand-icon');
            if (expandIcon) {
                expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle;"><polygon points="5,3 13,8 5,13" fill="#4a4a4a"/></svg>';
            }
            li.classList.remove('expanded');
        }
    }

    // 从父节点开始，递归显示所有后代
    showAllDescendants(parentLi);
}


    // ============================================================================
    // 主初始化函数
    // ============================================================================

    // 主初始化
    function initialize() {
        // 初始化树结构
        initializeTree();
        
        // 设置右键菜单
        setupContextMenu();
        
        // 设置按钮事件
        setupButtonEvents();
        
        // 设置搜索事件
        setupSearchEvents();
        
        // 初始化层级选择器
        setupDepthSelector();
        
        // 恢复滚动位置
        restoreScroll();
        
        // 初始化按钮状态
        updatePinButtonsState();
        
        // 保存滚动位置事件
        window.addEventListener('scroll', () => { saveScroll(); });
        window.addEventListener('beforeunload', () => { saveScroll(); });
    }

    // 启动初始化
    initialize();

})();
