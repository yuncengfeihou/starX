// public/extensions/third-party/favorites-plugin/index.js

// Import from the core script
import {
    // 保留你原来的导入
    // saveSettingsDebounced, // 我们不再需要在这里导入 saveSettingsDebounced
    eventSource,
    event_types,
    messageFormatting,
    chat, // 显式导入 chat 数组，以备 findMessageDataById 使用（尽管 getContext() 也提供）
} from '../../../../script.js';

// Import from the extension helper script
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
    saveMetadataDebounced // 确认从这里导入 saveMetadataDebounced
} from '../../../extensions.js';

// Import from the Popup utility script
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// Import from the general utility script
import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

// Define plugin folder name (important for consistency)
const pluginName = 'favorites-plugin'; // 使用 starX 作为日志前缀
const logPrefix = `${pluginName}:`;

// Initialize plugin settings if they don't exist (这部分可以保留)
if (!extension_settings[pluginName]) {
    extension_settings[pluginName] = {};
}

// Define HTML for the favorite toggle icon
const messageButtonHtml = `
    <div class="mes_button favorite-toggle-icon" title="收藏/取消收藏">
        <i class="fa-regular fa-star"></i>
    </div>
`;

// Store reference to the favorites popup
let favoritesPopup = null;
// Current pagination state
let currentPage = 1;
const itemsPerPage = 5; // 你可以调整每页显示的数量

/**
 * Ensures the favorites array exists in the current chat metadata
 * @returns {boolean} True if metadata is available and array exists/created, false otherwise
 */
function ensureFavoritesArrayExists() {
    // window.chat_metadata 是 SillyTavern 加载当前聊天时设置的全局变量
    if (typeof window.chat_metadata === 'undefined') {
         console.error(`${logPrefix} ensureFavoritesArrayExists - 退出：window.chat_metadata 未定义！`);
         return false; // 必须要有 chat_metadata
    }
    if (!Array.isArray(window.chat_metadata.favorites)) {
        console.log(`${logPrefix} ensureFavoritesArrayExists - 初始化 chat_metadata.favorites 数组。`);
        window.chat_metadata.favorites = [];
        // 注意：仅初始化通常不立即保存，除非特定需求
    }
    return true;
}

/**
 * Adds a favorite item to the current chat metadata
 * @param {Object} messageInfo Information about the message being favorited
 */
function addFavorite(messageInfo) {
    // --- addFavorite 调试点 1 ---
    console.log(`${logPrefix} addFavorite - 开始执行, messageInfo:`, messageInfo);

    if (!ensureFavoritesArrayExists()) {
        // --- addFavorite 调试点 2 ---
        console.error(`${logPrefix} addFavorite - 退出：ensureFavoritesArrayExists 返回 false`);
        return; // 如果无法确保数组存在，则退出
    }

    // 检查是否已存在 (防止意外重复添加，尽管UI逻辑应该避免)
    const existingIndex = window.chat_metadata.favorites.findIndex(fav => fav.messageId === messageInfo.messageId);
    if (existingIndex !== -1) {
        // --- addFavorite 调试点 3 ---
        console.warn(`${logPrefix} addFavorite - 警告：尝试添加已存在的收藏 (messageId: ${messageInfo.messageId})，跳过。`);
        return;
    }

    const item = {
        id: uuidv4(), // 生成唯一 ID
        messageId: messageInfo.messageId, // messageId 是从 mesid 属性来的字符串
        sender: messageInfo.sender,
        role: messageInfo.role,
        timestamp: messageInfo.timestamp, // 应该是数字时间戳
        note: '' // 初始备注为空
    };

    // --- addFavorite 调试点 4 ---
    console.log(`${logPrefix} addFavorite - 添加前 chat_metadata.favorites:`, JSON.stringify(window.chat_metadata.favorites));
    window.chat_metadata.favorites.push(item);
    // --- addFavorite 调试点 5 ---
    console.log(`${logPrefix} addFavorite - 添加后 chat_metadata.favorites:`, JSON.stringify(window.chat_metadata.favorites));

    // *** 调用导入的保存函数 ***
    // --- addFavorite 调试点 6 ---
    console.log(`${logPrefix} addFavorite - 即将调用 saveMetadataDebounced 来保存更改...`);
    saveMetadataDebounced(); // 调用从 extensions.js 导入的函数

    console.log(`${logPrefix} addFavorite - 完成: 添加了收藏项`, item);

    // 更新弹窗（如果已打开）
    if (favoritesPopup && favoritesPopup.isVisible()) {
        console.log(`${logPrefix} addFavorite - 更新打开的收藏弹窗`);
        updateFavoritesPopup();
    }
}

/**
 * Removes a favorite by its ID (usually called from popup)
 * @param {string} favoriteId The unique ID of the favorite to remove
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteById(favoriteId) {
    // --- removeFavoriteById 调试点 1 ---
    console.log(`${logPrefix} removeFavoriteById - 开始执行, favoriteId: ${favoriteId}`);

    if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites || window.chat_metadata.favorites.length === 0) {
        // --- removeFavoriteById 调试点 2 ---
        console.warn(`${logPrefix} removeFavoriteById - 退出：收藏数组不存在或为空。`);
        return false;
    }

    const indexToRemove = window.chat_metadata.favorites.findIndex(fav => fav.id === favoriteId);

    if (indexToRemove !== -1) {
        // --- removeFavoriteById 调试点 3 ---
        console.log(`${logPrefix} removeFavoriteById - 删除前 chat_metadata.favorites:`, JSON.stringify(window.chat_metadata.favorites));
        window.chat_metadata.favorites.splice(indexToRemove, 1);
        // --- removeFavoriteById 调试点 4 ---
        console.log(`${logPrefix} removeFavoriteById - 删除后 chat_metadata.favorites:`, JSON.stringify(window.chat_metadata.favorites));

        // *** 调用导入的保存函数 ***
        // --- removeFavoriteById 调试点 5 ---
        console.log(`${logPrefix} removeFavoriteById - 即将调用 saveMetadataDebounced 来保存更改...`);
        saveMetadataDebounced(); // 调用从 extensions.js 导入的函数

        console.log(`${logPrefix} removeFavoriteById - 完成: 移除了收藏项 ID: ${favoriteId}`);
        return true;
    } else {
        // --- removeFavoriteById 调试点 6 ---
        console.warn(`${logPrefix} removeFavoriteById - 未找到 ID 为 ${favoriteId} 的收藏项。`);
        return false;
    }
}

/**
 * Removes a favorite by the message ID it references (usually called from icon toggle)
 * @param {string} messageId The message ID string (from mesid attribute)
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteByMessageId(messageId) {
    // --- removeFavoriteByMessageId 调试点 1 ---
    console.log(`${logPrefix} removeFavoriteByMessageId - 开始执行, messageId: ${messageId}`);

    if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites || window.chat_metadata.favorites.length === 0) {
        // --- removeFavoriteByMessageId 调试点 2 ---
        console.warn(`${logPrefix} removeFavoriteByMessageId - 退出：收藏数组不存在或为空。`);
        return false;
    }

    // 查找对应的收藏项（使用 messageId 字符串进行比较）
    const favItem = window.chat_metadata.favorites.find(fav => fav.messageId === messageId);

    if (favItem) {
        // --- removeFavoriteByMessageId 调试点 3 ---
        console.log(`${logPrefix} removeFavoriteByMessageId - 找到收藏项 (favId: ${favItem.id}), 准备调用 removeFavoriteById`);
        // 复用按 favoriteId 删除的逻辑，该函数内部会处理保存和日志
        return removeFavoriteById(favItem.id);
    } else {
        // --- removeFavoriteByMessageId 调试点 4 ---
        console.warn(`${logPrefix} removeFavoriteByMessageId - 未找到引用 messageId ${messageId} 的收藏项。`);
        return false;
    }
}

/**
 * Updates the note for a favorite item
 * @param {string} favoriteId The ID of the favorite
 * @param {string} note The new note text
 */
function updateFavoriteNote(favoriteId, note) {
    // --- updateFavoriteNote 调试点 1 ---
    console.log(`${logPrefix} updateFavoriteNote - 开始执行, favoriteId: ${favoriteId}, note: ${note}`);

    if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites || window.chat_metadata.favorites.length === 0) {
         // --- updateFavoriteNote 调试点 2 ---
        console.warn(`${logPrefix} updateFavoriteNote - 退出：收藏数组不存在或为空。`);
        return;
    }

    const favorite = window.chat_metadata.favorites.find(fav => fav.id === favoriteId);
    if (favorite) {
        // --- updateFavoriteNote 调试点 3 ---
        console.log(`${logPrefix} updateFavoriteNote - 更新前 favorite.note: ${favorite.note}`);
        favorite.note = note;
        // --- updateFavoriteNote 调试点 4 ---
        console.log(`${logPrefix} updateFavoriteNote - 更新后 favorite.note: ${favorite.note}`);

        // *** 调用导入的保存函数 ***
        // --- updateFavoriteNote 调试点 5 ---
        console.log(`${logPrefix} updateFavoriteNote - 即将调用 saveMetadataDebounced 来保存更改...`);
        saveMetadataDebounced(); // 调用从 extensions.js 导入的函数

        console.log(`${logPrefix} updateFavoriteNote - 完成: 更新了收藏项 ${favoriteId} 的备注`);
    } else {
        // --- updateFavoriteNote 调试点 6 ---
        console.warn(`${logPrefix} updateFavoriteNote - 未找到 ID 为 ${favoriteId} 的收藏项来更新备注。`);
    }
}

// =========================================================================
// 主要的点击处理函数 - 包含详细调试日志
// =========================================================================
/**
 * Handles the toggle of favorite status when clicking the star icon
 * @param {Event} event The click event
 */
function handleFavoriteToggle(event) {
    // --- 调试点 1 ---
    console.log(`${logPrefix} handleFavoriteToggle - 开始执行`);

    // event.target 是实际被点击的元素 (可能是 <i> 或 <div>)
    // closest() 查找最近的符合选择器的祖先元素，或其自身
    const target = $(event.target).closest('.favorite-toggle-icon');
    if (!target.length) {
        // --- 调试点 2 ---
        console.log(`${logPrefix} handleFavoriteToggle - 退出：点击的目标不是或不在 .favorite-toggle-icon 内部`);
        return; // 如果点击的不是目标图标，退出
    }

    // 找到包含该图标的整个消息元素 (.mes)
    const messageElement = target.closest('.mes');
    if (!messageElement.length) {
        // --- 调试点 2.1 (新增) ---
        console.error(`${logPrefix} handleFavoriteToggle - 错误：找到了 .favorite-toggle-icon 但找不到父级 .mes 元素！`);
        return;
    }

    // 获取消息的 mesid 属性值（应该是字符串形式的索引）
    const messageIdString = messageElement.attr('mesid');
    if (typeof messageIdString === 'undefined' || messageIdString === null || messageIdString === '') {
        // --- 调试点 3 ---
        console.error(`${logPrefix} handleFavoriteToggle - 退出：在 .mes 元素上未找到有效的 mesid 属性`);
        return;
    }

    // 将 mesid 字符串转换为整数索引
    const messageIndex = parseInt(messageIdString, 10);
    if (isNaN(messageIndex)) {
        // --- 调试点 4 ---
        console.error(`${logPrefix} handleFavoriteToggle - 退出：mesid '${messageIdString}' 解析为 NaN (非数字)`);
        return;
    }

    // --- 调试点 5 ---
    console.log(`${logPrefix} handleFavoriteToggle - 获取 context 和消息对象 (索引: ${messageIndex}, mesid: '${messageIdString}')`);
    const context = getContext();
    // 检查 context.chat 是否存在且为数组
    if (!context || !Array.isArray(context.chat)) {
         // --- 调试点 5.1 (新增) ---
        console.error(`${logPrefix} handleFavoriteToggle - 错误：无法获取 context 或 context.chat 不是数组！`);
        return;
    }
    // 使用索引从 context.chat 数组中获取消息对象
    const message = context.chat[messageIndex];

    // 检查是否成功获取到消息对象
    if (!message) {
        // --- 调试点 6 ---
        console.error(`${logPrefix} handleFavoriteToggle - 退出：在 chat 数组索引 ${messageIndex} 处未找到有效的消息对象 (mesid: '${messageIdString}')`);
        return;
    }

    // --- 如果代码能执行到这里，说明前面的检查都通过了 ---
    console.log(`${logPrefix} handleFavoriteToggle - 成功获取消息对象:`, message);

    // 获取图标元素 (<i>) 并检查当前收藏状态
    const iconElement = target.find('i');
    if (!iconElement.length) {
         // --- 调试点 6.1 (新增) ---
        console.error(`${logPrefix} handleFavoriteToggle - 错误：在 .favorite-toggle-icon 内未找到 <i> 图标元素！`);
        return;
    }
    const isCurrentlyFavorited = iconElement.hasClass('fa-solid');
    console.log(`${logPrefix} handleFavoriteToggle - 当前收藏状态 (isCurrentlyFavorited): ${isCurrentlyFavorited}`);

    // 立即更新 UI 图标视觉状态
    if (isCurrentlyFavorited) {
        console.log(`${logPrefix} handleFavoriteToggle - UI: 切换到 '未收藏' 图标`);
        iconElement.removeClass('fa-solid').addClass('fa-regular');
    } else {
        console.log(`${logPrefix} handleFavoriteToggle - UI: 切换到 '已收藏' 图标`);
        iconElement.removeClass('fa-regular').addClass('fa-solid');
    }

    // 根据 *新* 的状态 (即 !isCurrentlyFavorited) 调用 addFavorite 或 removeFavoriteByMessageId
    if (!isCurrentlyFavorited) { // 如果之前是未收藏，现在要添加收藏
        console.log(`${logPrefix} handleFavoriteToggle - 准备调用 addFavorite`); // <--- 期望看到这个
        // 检查 message 对象是否包含必要属性
        if (typeof message.name === 'undefined' || typeof message.is_user === 'undefined' || typeof message.send_date === 'undefined') {
             console.error(`${logPrefix} handleFavoriteToggle - 错误：找到的消息对象缺少 name, is_user 或 send_date 属性!`, message);
             // 考虑是否要回滚图标状态？
             return;
        }
        const messageInfo = {
            messageId: messageIdString, // 使用从 mesid 获取的字符串
            sender: message.name,
            role: message.is_user ? 'user' : 'character',
            timestamp: message.send_date // 使用数字时间戳
        };
        addFavorite(messageInfo);
    } else { // 如果之前是已收藏，现在要移除收藏
        console.log(`${logPrefix} handleFavoriteToggle - 准备调用 removeFavoriteByMessageId`); // <--- 或者这个
        // 使用从 mesid 获取的字符串 ID 来移除
        removeFavoriteByMessageId(messageIdString);
    }

    console.log(`${logPrefix} handleFavoriteToggle - 执行完毕`);
}
// =========================================================================
// /结束 主要的点击处理函数
// =========================================================================


/**
 * Adds favorite toggle icons to all messages in the chat that don't have one
 * 优化：只处理视图内可见的消息，或者特定选择器
 */
function addFavoriteIconsToMessages() {
    // 选择 #chat 内所有还没有 .favorite-toggle-icon 的 .mes 元素
    $('#chat .mes:not(:has(.favorite-toggle-icon))').each(function() {
        const messageElement = $(this);
        const extraButtonsContainer = messageElement.find('.extraMesButtons');

        // 确保 .extraMesButtons 容器存在
        if (extraButtonsContainer.length) {
            // console.log(`${logPrefix} addFavoriteIconsToMessages - 向消息 ${messageElement.attr('mesid')} 添加图标`);
            extraButtonsContainer.append(messageButtonHtml);
        } else {
            // console.warn(`${logPrefix} addFavoriteIconsToMessages - 消息 ${messageElement.attr('mesid')} 缺少 .extraMesButtons 容器`);
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
function refreshFavoriteIconsInView() {
    // console.log(`${logPrefix} refreshFavoriteIconsInView - 开始刷新视图内图标状态`);
    if (!ensureFavoritesArrayExists()) {
        console.warn(`${logPrefix} refreshFavoriteIconsInView - 无法执行，ensureFavoritesArrayExists 返回 false`);
        return; // 如果元数据/数组有问题，直接退出
    }

    // 首先确保所有应该有图标的消息都有图标结构
    addFavoriteIconsToMessages();

    // 然后更新这些图标的视觉状态
    $('#chat .mes').each(function() {
        const messageElement = $(this);
        const messageId = messageElement.attr('mesid'); // 获取 mesid 字符串
        const iconContainer = messageElement.find('.favorite-toggle-icon'); // 找到图标的容器 div

        // 确保消息有 mesid 且图标容器存在
        if (messageId && iconContainer.length) {
            // 检查当前 messageId 是否在收藏列表中
            // window.chat_metadata.favorites 应该已经通过 ensureFavoritesArrayExists 确保存在
            const isFavorited = window.chat_metadata.favorites.some(fav => fav.messageId === messageId);

            // 获取实际的 <i> 图标元素
            const iconElement = iconContainer.find('i');
            if (iconElement.length) {
                // 根据收藏状态更新图标类
                if (isFavorited) {
                    iconElement.removeClass('fa-regular').addClass('fa-solid');
                } else {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
    });
    // console.log(`${logPrefix} refreshFavoriteIconsInView - 完成刷新`);
}

/**
 * Renders a single favorite item for the popup
 * @param {Object} favItem The favorite item to render
 * @returns {string} HTML string for the favorite item, or empty string if invalid
 */
function renderFavoriteItem(favItem) {
    if (!favItem || typeof favItem.id === 'undefined' || typeof favItem.messageId === 'undefined') {
         console.warn(`${logPrefix} renderFavoriteItem - 收到无效的 favItem:`, favItem);
         return ''; // 返回空字符串，避免渲染无效项
    }

    const context = getContext();
    let message = null;
    // 尝试使用 messageId (来自 mesid 的字符串) 作为索引查找
    const messageIndex = parseInt(favItem.messageId, 10);
    if (!isNaN(messageIndex) && context?.chat?.[messageIndex]) {
        message = context.chat[messageIndex];
        // 可选：再次验证 message.id 是否某种程度上与 favItem.messageId 关联，但这不再是查找的主要依据
    } else {
        // 如果按索引找不到，可以尝试（但不推荐，因为原始设计基于索引）按 ID 查找，但这可能找不到
        // message = context?.chat?.find(msg => String(msg.id) === favItem.messageId);
        console.warn(`${logPrefix} renderFavoriteItem - 按索引 ${messageIndex} 未找到原始消息 (favId: ${favItem.id}, messageId: ${favItem.messageId})`);
    }


    let previewText = '';
    let deletedClass = 'deleted'; // 默认假设已删除

    if (message && message.mes) {
        // 获取消息内容预览
        previewText = message.mes;
        if (previewText.length > 100) { // 限制预览长度
            previewText = previewText.substring(0, 100) + '...';
        }
        // 可选: 使用 messageFormatting 进行格式化，但可能增加复杂性且未必需要
        // previewText = messageFormatting(previewText, favItem.sender, false, favItem.role === 'user', null, {}, false);
        previewText = escapeHtml(previewText); // 基本的 HTML 转义避免 XSS
        deletedClass = ''; // 找到了消息，不是删除状态
    } else {
        previewText = '[消息已删除或不在当前视图]';
    }

    // 格式化时间戳
    let formattedTime = '未知时间';
    if (favItem.timestamp && !isNaN(Number(favItem.timestamp))) {
         // SillyTavern 的 timestampToMoment 需要的是毫秒，而 message.send_date 可能是秒或毫秒，需确认
         // 假设 favItem.timestamp 是秒级 Unix 时间戳
         try {
            formattedTime = timestampToMoment(favItem.timestamp * 1000).format('YYYY-MM-DD HH:mm');
         } catch (e) {
            console.error(`${logPrefix} renderFavoriteItem - 格式化时间戳失败 (timestamp: ${favItem.timestamp}):`, e);
            formattedTime = new Date(favItem.timestamp * 1000).toLocaleString(); // 备用格式化
         }
    } else {
        console.warn(`${logPrefix} renderFavoriteItem - 无效的时间戳 (timestamp: ${favItem.timestamp})`);
    }


    // 使用 HTML 模板字符串生成列表项
    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}">
            <div class="fav-meta">${escapeHtml(favItem.sender || '未知发送者')} (${escapeHtml(favItem.role || '未知角色')}) - ${formattedTime}</div>
            <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">备注：${escapeHtml(favItem.note || '')}</div>
            <div class="fav-preview ${deletedClass}">${previewText}</div> {/* previewText 已转义 */}
            <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
}

// 辅助函数：HTML 转义
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
         .replace(/&/g, "&")
         .replace(/</g, "<")
         .replace(/>/g, ">")
         .replace(/"/g, """)
         .replace(/'/g, "'");
 }


/**
 * Updates the favorites popup with current data
 */
function updateFavoritesPopup() {
    console.log(`${logPrefix} updateFavoritesPopup - 开始更新弹窗`);
    if (!favoritesPopup) {
        console.warn(`${logPrefix} updateFavoritesPopup - 退出：弹窗实例不存在`);
        return;
    }
    if (!ensureFavoritesArrayExists()) {
        console.warn(`${logPrefix} updateFavoritesPopup - 退出：ensureFavoritesArrayExists 返回 false`);
        // 即使数组不存在，也应该显示一个空的或错误状态的弹窗
        favoritesPopup.content = '<div class="favorites-popup-content"><div class="favorites-empty">无法加载收藏数据。</div><div class="favorites-footer"><button class="menu_button close-popup">关闭</button></div></div>';
        favoritesPopup.update();
        return;
    }

    const context = getContext();
    // 获取当前聊天名称（处理私聊和群聊）
    let chatName = '未知聊天';
    try {
        if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
            chatName = context.characters[context.characterId].name;
        } else if (context.groupId && context.groups) {
            const group = context.groups.find(g => g.id === context.groupId);
            chatName = group ? `群组: ${group.name}` : `群组 ID: ${context.groupId}`;
        } else if (context.name2) { // 备用，如果 context 结构变化
             chatName = context.name2;
        }
    } catch (e) {
        console.error(`${logPrefix} updateFavoritesPopup - 获取聊天名称时出错:`, e);
    }

    const favoritesList = window.chat_metadata.favorites || []; // 再次确保是数组
    const totalFavorites = favoritesList.length;
    console.log(`${logPrefix} updateFavoritesPopup - 总收藏数: ${totalFavorites}`);

    // 按时间戳排序（升序，旧->新）
    const sortedFavorites = [...favoritesList].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // --- 分页逻辑 ---
    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    if (currentPage > totalPages) {
        console.log(`${logPrefix} updateFavoritesPopup - 当前页 (${currentPage}) 大于总页数 (${totalPages})，重置为最后一页`);
        currentPage = totalPages;
    }
    if (currentPage < 1) {
         currentPage = 1; // 确保页码不小于 1
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    // slice 的第二个参数是结束索引（不包含），所以不需要 +1
    const currentPageItems = sortedFavorites.slice(startIndex, startIndex + itemsPerPage);
    console.log(`${logPrefix} updateFavoritesPopup - 当前页: ${currentPage}, 总页数: ${totalPages}, 显示索引: ${startIndex} 到 ${startIndex + itemsPerPage - 1}`);
    // --- 分页逻辑结束 ---


    // 构建弹窗内容 HTML
    let content = `
        <div class="favorites-popup-content">
            <div class="favorites-header">
                <h3>${escapeHtml(chatName)} - ${totalFavorites} 条收藏</h3>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;

    if (totalFavorites === 0) {
        content += `<div class="favorites-empty">当前聊天没有收藏的消息。<br>点击消息右下角的 <i class="fa-regular fa-star"></i> 图标来添加。</div>`;
    } else if (currentPageItems.length === 0 && totalFavorites > 0) {
        // 处理可能的边界情况，例如页码错误导致当前页没有项目
        content += `<div class="favorites-empty">当前页没有收藏项（可能页码错误）。</div>`;
        console.warn(`${logPrefix} updateFavoritesPopup - 当前页项目为空，但总数 (${totalFavorites}) > 0`);
    }
    else {
        currentPageItems.forEach((favItem) => {
            content += renderFavoriteItem(favItem); // 调用渲染单项的函数
        });

        // 添加分页控件（如果需要）
        if (totalPages > 1) {
            content += `<div class="favorites-pagination">`;
            content += `<button class="menu_button pagination-prev" ${currentPage === 1 ? 'disabled' : ''} title="上一页"><i class="fa-solid fa-arrow-left"></i></button>`;
            content += `<span> Page ${currentPage} / ${totalPages} </span>`;
            content += `<button class="menu_button pagination-next" ${currentPage === totalPages ? 'disabled' : ''} title="下一页"><i class="fa-solid fa-arrow-right"></i></button>`;
            content += `</div>`;
        }
    }

    content += `
            </div>
            <hr>
            <div class="favorites-footer">
                <button class="menu_button clear-invalid" title="移除那些原始消息已被删除的收藏条目"><i class="fa-solid fa-broom"></i> 清理无效收藏</button>
                <button class="menu_button close-popup" title="关闭此弹窗"><i class="fa-solid fa-circle-xmark"></i> 关闭</button>
            </div>
        </div>
    `;

    // 更新弹窗内容并重新绘制
    if (favoritesPopup) {
        favoritesPopup.content = content;
        favoritesPopup.update();
        console.log(`${logPrefix} updateFavoritesPopup - 弹窗内容已更新`);
    } else {
        console.error(`${logPrefix} updateFavoritesPopup - 尝试更新时 favoritesPopup 实例丢失！`);
    }
}


/**
 * Opens or updates the favorites popup
 */
function showFavoritesPopup() {
    console.log(`${logPrefix} showFavoritesPopup - 尝试显示弹窗`);
    // 确保收藏数组存在
    ensureFavoritesArrayExists();

    if (!favoritesPopup) {
        console.log(`${logPrefix} showFavoritesPopup - 创建新的 Popup 实例`);
        // 初始内容可以为空，将在 updateFavoritesPopup 中填充
        favoritesPopup = new Popup('收藏的消息', '', {
            buttons: [], // 移除默认按钮，我们在 HTML 中自己定义
            wide: true,  // 使用更宽的弹窗
            // large: true // 可能不需要 large，wide 可能足够
        });
        // favoritesPopup.width = 600; // 可以直接设置宽度像素值

        // *** 使用事件委托处理弹窗内部的交互 ***
        // 将监听器附加到弹窗的 DOM 元素上，而不是 document
        // 使用 .popup 获取弹窗的顶层 DOM 元素
        $(favoritesPopup.popup).on('click', function(event) {
            const target = $(event.target); // 被点击的实际元素
            const closestButton = target.closest('button'); // 最近的按钮
            const closestIcon = target.closest('i');       // 最近的图标
            const closestItem = target.closest('.favorite-item'); // 最近的列表项

            // --- 弹窗交互调试 ---
            // console.log(`${logPrefix} Popup Click - Target:`, target[0].tagName, `Classes: ${target.attr('class')}`);

            // 分页按钮
            if (closestButton.hasClass('pagination-prev')) {
                console.log(`${logPrefix} Popup Click - 上一页按钮`);
                if (currentPage > 1) {
                    currentPage--;
                    updateFavoritesPopup();
                }
            } else if (closestButton.hasClass('pagination-next')) {
                console.log(`${logPrefix} Popup Click - 下一页按钮`);
                const favoritesList = window.chat_metadata?.favorites || [];
                const totalPages = Math.max(1, Math.ceil(favoritesList.length / itemsPerPage));
                if (currentPage < totalPages) {
                    currentPage++;
                    updateFavoritesPopup();
                }
            }
            // 关闭按钮
            else if (closestButton.hasClass('close-popup')) {
                console.log(`${logPrefix} Popup Click - 关闭按钮`);
                favoritesPopup.hide();
            }
            // 清理无效收藏按钮
            else if (closestButton.hasClass('clear-invalid')) {
                console.log(`${logPrefix} Popup Click - 清理无效收藏按钮`);
                handleClearInvalidFavorites(); // 调用清理函数
            }
            // 编辑备注图标 (fa-pencil)
            else if (closestIcon.hasClass('fa-pencil') && closestItem.length) {
                const favId = closestItem.data('fav-id');
                console.log(`${logPrefix} Popup Click - 编辑备注图标 (favId: ${favId})`);
                if (favId) {
                    handleEditNote(favId); // 调用编辑备注函数
                } else {
                     console.error(`${logPrefix} Popup Click - 无法从列表项获取 fav-id 用于编辑`);
                }
            }
            // 删除收藏图标 (fa-trash)
            else if (closestIcon.hasClass('fa-trash') && closestItem.length) {
                const favId = closestItem.data('fav-id');
                const msgId = closestItem.data('msg-id'); // 获取关联的 messageId
                console.log(`${logPrefix} Popup Click - 删除收藏图标 (favId: ${favId}, msgId: ${msgId})`);
                if (favId && msgId !== undefined) { // 确保两者都存在
                    handleDeleteFavoriteFromPopup(favId, String(msgId)); // 调用弹窗删除函数，确保 msgId 是字符串
                } else {
                     console.error(`${logPrefix} Popup Click - 无法从列表项获取 fav-id 或 msg-id 用于删除`);
                }
            }
        });
    }

    // 每次打开时重置到第一页
    currentPage = 1;
    console.log(`${logPrefix} showFavoritesPopup - 重置到第一页`);
    // 更新弹窗内容（加载数据并渲染）
    updateFavoritesPopup();
    // 显示弹窗
    favoritesPopup.show();
    console.log(`${logPrefix} showFavoritesPopup - 弹窗已显示`);
}

/**
 * Handles the deletion of a favorite from the popup, including confirmation
 * @param {string} favId The favorite ID
 * @param {string} messageId The message ID string (from mesid)
 */
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    console.log(`${logPrefix} handleDeleteFavoriteFromPopup - 准备删除 (favId: ${favId}, msgId: ${messageId})`);
    // 弹出确认对话框
    const confirmResult = await callGenericPopup(
        '确定要删除这条收藏吗？<br><small>(此操作不可撤销)</small>',
        POPUP_TYPE.CONFIRM,
        { okButton: '确定删除', cancelButton: '取消' } // 自定义按钮文本
    );

    // 检查确认结果
    if (confirmResult === POPUP_RESULT.AFFIRMATIVE || confirmResult === POPUP_RESULT.OK) { // 兼容不同的确认结果值
        console.log(`${logPrefix} handleDeleteFavoriteFromPopup - 用户确认删除`);
        // 调用按 ID 删除收藏的函数
        if (removeFavoriteById(favId)) {
            console.log(`${logPrefix} handleDeleteFavoriteFromPopup - 收藏项已从数据中移除`);
            // 成功删除后，更新弹窗内容
            updateFavoritesPopup();

            // **关键**：同时更新主聊天界面中对应消息的图标状态（如果该消息可见）
            // 使用 messageId (字符串) 来查找 DOM 元素
            const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
            if (messageElement.length) {
                const iconElement = messageElement.find('.favorite-toggle-icon i');
                if (iconElement.length) {
                    console.log(`${logPrefix} handleDeleteFavoriteFromPopup - 更新聊天界面中消息 ${messageId} 的图标为未收藏`);
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                } else {
                    console.warn(`${logPrefix} handleDeleteFavoriteFromPopup - 找到了消息 ${messageId} 但未找到其收藏图标`);
                }
            } else {
                // console.log(`${logPrefix} handleDeleteFavoriteFromPopup - 消息 ${messageId} 不在当前聊天视图中，无需更新图标`);
            }
        } else {
            // 删除失败（可能ID不存在等原因），removeFavoriteById 内部应该有日志
            console.error(`${logPrefix} handleDeleteFavoriteFromPopup - removeFavoriteById(${favId}) 调用失败`);
            // 可以选择性地给用户一个提示
            callGenericPopup('删除收藏失败，请检查控制台日志。', POPUP_TYPE.ERROR);
        }
    } else {
        console.log(`${logPrefix} handleDeleteFavoriteFromPopup - 用户取消删除`);
    }
}

/**
 * Handles editing the note for a favorite item via a popup
 * @param {string} favId The favorite ID
 */
async function handleEditNote(favId) {
    console.log(`${logPrefix} handleEditNote - 准备编辑备注 (favId: ${favId})`);
    if (!ensureFavoritesArrayExists()) {
         console.error(`${logPrefix} handleEditNote - 无法编辑，收藏数组不存在`);
         return;
    }

    const favorite = window.chat_metadata.favorites.find(fav => fav.id === favId);
    if (!favorite) {
        console.error(`${logPrefix} handleEditNote - 未找到 ID 为 ${favId} 的收藏项`);
        callGenericPopup(`错误：找不到 ID 为 ${favId} 的收藏项。`, POPUP_TYPE.ERROR);
        return;
    }

    // 使用带有当前备注的输入框弹出
    const result = await callGenericPopup(
        '编辑备注:', // 提示信息
        POPUP_TYPE.INPUT, // 弹窗类型
        favorite.note || '', // 默认值（当前备注或空字符串）
        { rows: 3 } // 可以设置输入框的行数
    );

    // callGenericPopup 在取消时返回 null，确认时返回输入的值
    if (result !== null) {
        console.log(`${logPrefix} handleEditNote - 用户输入了新的备注: "${result}"`);
        // 只有当备注实际发生变化时才更新和保存（可选优化）
        if (result !== (favorite.note || '')) {
            updateFavoriteNote(favId, result); // 更新数据并保存
            // 实时更新弹窗中的备注显示
            // 可以在 updateFavoritesPopup 中完成，或者直接操作 DOM (如果弹窗可见)
             if (favoritesPopup && favoritesPopup.isVisible()) {
                 // 找到对应的列表项并更新备注 div 的内容
                 const itemElement = $(favoritesPopup.popup).find(`.favorite-item[data-fav-id="${favId}"] .fav-note`);
                 if (itemElement.length) {
                     itemElement.text(`备注：${escapeHtml(result)}`).css('display', result ? '' : 'none');
                     console.log(`${logPrefix} handleEditNote - 实时更新了弹窗中的备注显示`);
                 } else {
                      console.warn(`${logPrefix} handleEditNote - 未能在弹窗中找到对应的备注元素实时更新`);
                      updateFavoritesPopup(); // 备用：完全刷新弹窗
                 }
             }
        } else {
            console.log(`${logPrefix} handleEditNote - 备注未更改，无需操作`);
        }
    } else {
         console.log(`${logPrefix} handleEditNote - 用户取消了编辑备注`);
    }
}

/**
 * Clears invalid favorites (those referencing deleted or out-of-view messages)
 */
async function handleClearInvalidFavorites() {
    console.log(`${logPrefix} handleClearInvalidFavorites - 开始清理无效收藏`);
    if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites || window.chat_metadata.favorites.length === 0) {
        console.log(`${logPrefix} handleClearInvalidFavorites - 没有收藏项可清理`);
        await callGenericPopup('当前聊天没有收藏项可清理。', POPUP_TYPE.TEXT);
        return;
    }

    const context = getContext();
    const currentChatMessages = context?.chat || []; // 获取当前加载的聊天消息数组
    const invalidFavoriteIds = []; // 存储无效收藏的 ID

    console.log(`${logPrefix} handleClearInvalidFavorites - 当前加载的消息数: ${currentChatMessages.length}`);

    // 遍历当前聊天的所有收藏项
    window.chat_metadata.favorites.forEach(fav => {
        // 尝试根据收藏项的 messageId (字符串索引) 查找对应的消息
        const messageIndex = parseInt(fav.messageId, 10);
        // 检查索引是否有效，以及该索引处的消息是否存在
        const messageExists = !isNaN(messageIndex) && currentChatMessages[messageIndex];

        if (!messageExists) {
            // 如果消息不存在（索引无效或该索引处无消息），则认为是无效收藏
            console.log(`${logPrefix} handleClearInvalidFavorites - 发现无效收藏 (favId: ${fav.id}, messageId: ${fav.messageId}) - 消息不存在于当前 chat 数组`);
            invalidFavoriteIds.push(fav.id);
        }
    });

    if (invalidFavoriteIds.length === 0) {
        console.log(`${logPrefix} handleClearInvalidFavorites - 没有找到无效的收藏项`);
        await callGenericPopup('没有找到引用已删除或无法访问消息的无效收藏项。', POPUP_TYPE.TEXT);
        return;
    }

    // 弹出确认对话框，告知用户将删除多少无效项
    const confirmResult = await callGenericPopup(
        `发现 ${invalidFavoriteIds.length} 条无效收藏（原始消息可能已删除或不在当前加载范围）。<br>确定要移除这些无效收藏吗？`,
        POPUP_TYPE.CONFIRM,
        { okButton: '确定清理', cancelButton: '取消' }
    );

    if (confirmResult === POPUP_RESULT.AFFIRMATIVE || confirmResult === POPUP_RESULT.OK) {
        console.log(`${logPrefix} handleClearInvalidFavorites - 用户确认清理`);
        // 使用 filter 方法创建新的收藏数组，只包含有效的收藏项
        const originalCount = window.chat_metadata.favorites.length;
        window.chat_metadata.favorites = window.chat_metadata.favorites.filter(
            fav => !invalidFavoriteIds.includes(fav.id) // 保留不在无效 ID 列表中的项
        );
        const removedCount = originalCount - window.chat_metadata.favorites.length;
        console.log(`${logPrefix} handleClearInvalidFavorites - 移除了 ${removedCount} 条无效收藏`);

        // 保存更改
        saveMetadataDebounced();

        // 提示用户清理结果
        await callGenericPopup(`已成功清理 ${removedCount} 条无效收藏。`, POPUP_TYPE.TEXT);

        // 更新收藏弹窗（如果打开）
        if (favoritesPopup && favoritesPopup.isVisible()) {
            updateFavoritesPopup();
        }
    } else {
        console.log(`${logPrefix} handleClearInvalidFavorites - 用户取消清理`);
    }
}

// =========================================================================
// 插件初始化入口点
// =========================================================================
jQuery(async () => {
    try {
        console.log(`${logPrefix} 插件加载中...`);

        // --- 1. 注入侧边栏按钮 ---
        try {
            console.log(`${logPrefix} 尝试加载 input_button.html`);
            // 确保插件文件夹名称正确
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            console.log(`${logPrefix} 已将按钮添加到 #data_bank_wand_container`);

            // 为按钮绑定点击事件 (确保按钮 ID 正确)
            // 假设你的 input_button.html 中的按钮 ID 是 "favorites-plugin-button"
            $('#favorites_button').on('click', () => {
                console.log(`${logPrefix} 侧边栏按钮被点击`);
                showFavoritesPopup(); // 点击时显示弹窗
            });
            console.log(`${logPrefix} 已为侧边栏按钮绑定点击事件`);
        } catch (error) {
            console.error(`${logPrefix} 加载或注入 input_button.html 失败:`, error);
        }

        // --- 2. (可选) 注入设置面板 ---
        // 如果你的插件有设置，可以在这里注入
        /*
        try {
            console.log(`${logPrefix} 尝试加载 settings_display.html`);
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            // 目标容器可能需要根据你的 ST 版本调整，#extensions_settings 或 #settings_container 等
            $('#extensions_settings').append(settingsHtml);
            console.log(`${logPrefix} 已将设置 UI 添加到 #extensions_settings`);
            // 为设置面板中的元素绑定事件...
        } catch (error) {
            console.error(`${logPrefix} 加载或注入 settings_display.html 失败:`, error);
        }
        */

        // --- 3. 设置核心事件委托 ---
        // 监听整个 #chat 容器上的点击事件，但只处理来自 .favorite-toggle-icon 的点击
        console.log(`${logPrefix} 设置 .favorite-toggle-icon 的事件委托`);
        // 使用命名空间 .favoritesPlugin 确保可以方便地移除监听器（如果需要）
        $('#chat').off('click.favoritesPlugin').on('click.favoritesPlugin', '.favorite-toggle-icon', handleFavoriteToggle);


        // --- 4. 初始化当前聊天的收藏状态 ---
        console.log(`${logPrefix} 初始化当前聊天收藏状态`);
        ensureFavoritesArrayExists(); // 确保当前 chat_metadata.favorites 存在
        refreshFavoriteIconsInView(); // 刷新视图内所有消息的图标状态


        // --- 5. 设置 SillyTavern 事件监听器 ---

        // 聊天切换事件
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`${logPrefix} ${event_types.CHAT_CHANGED} 事件触发`);
            // 切换聊天后，SillyTavern 会加载新的 chat_metadata
            ensureFavoritesArrayExists(); // 确保新聊天的数组存在
            // 稍微延迟执行，给 DOM 更新留出时间
            setTimeout(() => {
                console.log(`${logPrefix} CHAT_CHANGED 后延迟执行 refreshFavoriteIconsInView`);
                refreshFavoriteIconsInView(); // 刷新新聊天中可见消息的图标
            }, 150); // 延迟时间可以调整
        });

        // 消息被删除事件
        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageId) => {
            console.log(`${logPrefix} ${event_types.MESSAGE_DELETED} 事件触发, deletedMessageId: ${deletedMessageId}`);
            if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites || window.chat_metadata.favorites.length === 0) return;

            // 注意：SillyTavern 的 MESSAGE_DELETED 事件可能传递的是索引，也可能是 ID，需要确认
            // 假设它传递的是索引 (数字)
            const deletedIndexStr = String(deletedMessageId); // 将其转为字符串，因为我们存储的是字符串

            const favIndex = window.chat_metadata.favorites.findIndex(fav => fav.messageId === deletedIndexStr);

            if (favIndex !== -1) {
                const favIdToRemove = window.chat_metadata.favorites[favIndex].id;
                console.log(`${logPrefix} MESSAGE_DELETED - 消息 ${deletedMessageId} (索引) 被删除，对应的收藏项 (favId: ${favIdToRemove}) 将被移除`);
                // 调用 removeFavoriteById，它会处理保存和日志
                if(removeFavoriteById(favIdToRemove)) {
                    // 如果弹窗打开，更新它
                    if (favoritesPopup && favoritesPopup.isVisible()) {
                        console.log(`${logPrefix} MESSAGE_DELETED - 更新打开的收藏弹窗`);
                        updateFavoritesPopup();
                    }
                }
            }
        });

        // 收到新消息 (来自对方)
        eventSource.on(event_types.MESSAGE_RECEIVED, (message) => {
             // message 参数可能是新消息的对象或其 ID/索引
             // console.log(`${logPrefix} ${event_types.MESSAGE_RECEIVED} 事件触发`, message);
             // 新消息会被添加到 DOM 中，我们需要确保它有收藏图标
             // 使用延迟确保 DOM 更新完成
             setTimeout(() => {
                // console.log(`${logPrefix} MESSAGE_RECEIVED 后延迟执行 addFavoriteIconsToMessages & refresh`);
                 addFavoriteIconsToMessages();
                 // refreshFavoriteIconsInView(); // 可选：如果新消息需要立即检查是否已收藏（理论上新消息不会）
             }, 150);
        });

        // 发送新消息 (来自用户)
        eventSource.on(event_types.MESSAGE_SENT, (message) => {
             // console.log(`${logPrefix} ${event_types.MESSAGE_SENT} 事件触发`, message);
             setTimeout(() => {
                // console.log(`${logPrefix} MESSAGE_SENT 后延迟执行 addFavoriteIconsToMessages & refresh`);
                 addFavoriteIconsToMessages();
             }, 150);
        });

        // 消息内容被更新 (例如 编辑消息 / AI 重新生成)
        eventSource.on(event_types.MESSAGE_UPDATED, (messageId) => {
            // messageId 可能是索引或 ID
            // console.log(`${logPrefix} ${event_types.MESSAGE_UPDATED} 事件触发, messageId: ${messageId}`);
             setTimeout(() => {
                // console.log(`${logPrefix} MESSAGE_UPDATED 后延迟执行 addFavoriteIconsToMessages & refresh`);
                 // 确保更新后的消息也有图标
                 addFavoriteIconsToMessages();
                 // 刷新状态，以防万一（虽然通常更新消息不影响收藏状态）
                 refreshFavoriteIconsInView();
             }, 150);
        });

        // 加载更多历史消息
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
            console.log(`${logPrefix} ${event_types.MORE_MESSAGES_LOADED} 事件触发`);
             setTimeout(() => {
                console.log(`${logPrefix} MORE_MESSAGES_LOADED 后延迟执行 addFavoriteIconsToMessages & refresh`);
                 // 为新加载的历史消息添加图标并刷新状态
                 addFavoriteIconsToMessages();
                 refreshFavoriteIconsInView();
             }, 150);
        });

        // --- 6. (可选) 使用 MutationObserver 监视聊天内容的动态变化 ---
        // 这可以更可靠地捕捉到消息的添加/删除，但可能消耗更多资源
        /*
        console.log(`${logPrefix} 设置 MutationObserver 监视 #chat`);
        const chatObserver = new MutationObserver((mutations) => {
            let needsUpdate = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList') { // 只关心子节点的增删
                    // 检查是否有 .mes 节点被添加
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && $(node).hasClass('mes')) {
                            needsUpdate = true;
                        }
                    });
                    // 也可以检查是否有 .mes 节点被移除，但这通常由 MESSAGE_DELETED 事件处理
                }
            }
            if (needsUpdate) {
                // console.log(`${logPrefix} MutationObserver 检测到聊天变化，延迟执行图标添加/刷新`);
                // 使用 debounce 或 throttle 避免过于频繁的调用
                setTimeout(() => {
                    addFavoriteIconsToMessages();
                    refreshFavoriteIconsInView();
                }, 200); // 稍微长一点的延迟
            }
        });

        // 开始观察 #chat 容器的子节点变化
        const chatElement = document.getElementById('chat');
        if (chatElement) {
            chatObserver.observe(chatElement, {
                childList: true, // 监视子节点的添加或删除
                subtree: false   // 通常不需要监视子树，除非消息结构很复杂
            });
            console.log(`${logPrefix} MutationObserver 已启动`);
        } else {
            console.error(`${logPrefix} 无法启动 MutationObserver，未找到 #chat 元素`);
        }
        */

        console.log(`${logPrefix} 插件加载完成!`);

    } catch (error) {
        console.error(`${logPrefix} 初始化过程中发生严重错误:`, error);
        // 可以在这里向用户显示一个错误提示
        callGenericPopup(`收藏插件加载失败，请检查浏览器控制台获取详细信息。\n\n错误: ${error.message}`, POPUP_TYPE.ERROR);
    }
});
