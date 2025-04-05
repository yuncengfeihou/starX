// public/extensions/third-party/favorites-plugin/index.js

// Import from the core script
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    messageFormatting,
} from '../../../../script.js';

// Import from the extension helper script
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
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
const pluginName = 'starX';

// Initialize plugin settings if they don't exist
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
const itemsPerPage = 5;

/**
 * Ensures the favorites array exists in the current chat metadata
 * @returns {boolean} True if metadata is available, false otherwise
 */
function ensureFavoritesArrayExists() {
    if (!window.chat_metadata) return false;
    if (!Array.isArray(window.chat_metadata.favorites)) {
        console.log(`${pluginName}: Initializing chat_metadata.favorites array for current chat.`);
        window.chat_metadata.favorites = [];
    }
    return true;
}

/**
 * Adds a favorite item to the current chat metadata
 * @param {Object} messageInfo Information about the message being favorited
 */
function addFavorite(messageInfo) {
    if (!ensureFavoritesArrayExists()) return;

    const item = {
        id: uuidv4(),
        messageId: messageInfo.messageId,
        sender: messageInfo.sender,
        role: messageInfo.role,
        timestamp: messageInfo.timestamp,
        note: ''
    };

    window.chat_metadata.favorites.push(item);
    saveMetadataDebounced();
    console.log(`${pluginName}: Added favorite:`, item);

    // Update the popup if it's open
    if (favoritesPopup && favoritesPopup.isVisible()) {
        updateFavoritesPopup();
    }
}

/**
 * Removes a favorite by its ID
 * @param {string} favoriteId The ID of the favorite to remove
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteById(favoriteId) {
    if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites.length) return false;
    
    const indexToRemove = window.chat_metadata.favorites.findIndex(fav => fav.id === favoriteId);
    if (indexToRemove !== -1) {
        window.chat_metadata.favorites.splice(indexToRemove, 1);
        saveMetadataDebounced();
        console.log(`${pluginName}: Favorite removed: ${favoriteId}`);
        return true;
    }
    
    console.warn(`${pluginName}: Favorite with id ${favoriteId} not found.`);
    return false;
}

/**
 * Removes a favorite by the message ID it references
 * @param {string} messageId The message ID
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteByMessageId(messageId) {
    if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites.length) return false;
    
    const favItem = window.chat_metadata.favorites.find(fav => fav.messageId === messageId);
    if (favItem) {
        return removeFavoriteById(favItem.id);
    }
    
    console.warn(`${pluginName}: Favorite for messageId ${messageId} not found.`);
    return false;
}

/**
 * Updates the note for a favorite item
 * @param {string} favoriteId The ID of the favorite
 * @param {string} note The new note text
 */
function updateFavoriteNote(favoriteId, note) {
    if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites.length) return;
    
    const favorite = window.chat_metadata.favorites.find(fav => fav.id === favoriteId);
    if (favorite) {
        favorite.note = note;
        saveMetadataDebounced();
        console.log(`${pluginName}: Updated note for favorite ${favoriteId}`);
    }
}

/**
 * Handles the toggle of favorite status when clicking the star icon
 * @param {Event} event The click event
 */
function handleFavoriteToggle(event) {
    const target = $(event.target).closest('.favorite-toggle-icon');
    if (!target.length) return;

    const messageElement = target.closest('.mes');
    const mesid = messageElement.attr('mesid'); // 这个是索引字符串
    if (mesid === null || mesid === undefined) {
        console.error(`${pluginName}: Could not find mesid attribute for favorite toggle`);
        return;
    }

    const messageIndex = parseInt(mesid); // 将索引字符串转为数字
    if (isNaN(messageIndex)) {
        console.error(`${pluginName}: mesid "${mesid}" is not a valid number index.`);
        return;
    }

    // 切换图标视觉状态...
    const iconElement = target.find('i');
    const isCurrentlyFavorited = iconElement.hasClass('fa-solid');
    if (isCurrentlyFavorited) {
        iconElement.removeClass('fa-solid').addClass('fa-regular');
    } else {
        iconElement.removeClass('fa-regular').addClass('fa-solid');
    }

    // 根据新的状态更新数据
    if (!isCurrentlyFavorited) { // === 添加收藏 ===
        const context = getContext();
        const message = context.chat[messageIndex]; // 使用索引直接获取消息对象

        if (!message) {
            console.error(`${pluginName}: Could not find message data at index ${messageIndex} (from mesid ${mesid})`);
            return;
        }

        // !!! 关键：创建收藏信息时，使用 message.id !!!
        const messageInfo = {
            messageId: message.id, // <-- 存储真实的 message.id
            sender: message.name,
            role: message.is_user ? 'user' : 'character',
            timestamp: message.send_date ? Math.floor(new Date(message.send_date).getTime() / 1000) : Math.floor(Date.now() / 1000)
        };

        addFavorite(messageInfo); // addFavorite 函数内部会将包含真实 message.id 的对象存入 chat_metadata

    } else { // === 取消收藏 ===
        const context = getContext();
        const messageToRemove = context.chat[messageIndex]; // 同样使用索引找到消息对象

        if (messageToRemove && messageToRemove.id) {
            // !!! 关键：使用 message.id 来执行删除 !!!
            removeFavoriteByMessageId(messageToRemove.id); // removeFavoriteByMessageId 应该基于真实的 message.id 工作
        } else {
             console.warn(`${pluginName}: Could not find message or message.id at index ${messageIndex} to remove favorite.`);
        }
    }
}

/**
 * Adds favorite toggle icons to all messages in the chat that don't have one
 */
function addFavoriteIconsToMessages() {
    // Select all messages that don't have the favorite icon
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const extraButtonsContainer = messageElement.find('.extraMesButtons');
        
        // Check if the container exists and doesn't already have our icon
        if (extraButtonsContainer.length && !extraButtonsContainer.find('.favorite-toggle-icon').length) {
            extraButtonsContainer.append(messageButtonHtml);
            console.log(`${pluginName}: Added favorite icon to message ${messageElement.attr('mesid')}`);
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
function refreshFavoriteIconsInView() {
    if (!ensureFavoritesArrayExists()) return;
    addFavoriteIconsToMessages(); // 确保图标存在

    const context = getContext(); // 获取 context
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const mesid = messageElement.attr('mesid');
        if (mesid === null || mesid === undefined) return; // 跳过无效的

        const messageIndex = parseInt(mesid);
        if (isNaN(messageIndex)) return; // 跳过无效索引

        const message = context.chat[messageIndex]; // 用索引获取消息对象

        if (message && message.id) { // 确保消息和真实 ID 存在
            const realMessageId = message.id; // 获取真实的 message.id
            // 使用真实的 message.id 去检查收藏状态
            const isFavorited = window.chat_metadata.favorites.some(fav => fav.messageId === realMessageId);

            const iconElement = messageElement.find('.favorite-toggle-icon i');
            if (iconElement.length) {
                if (isFavorited) {
                    iconElement.removeClass('fa-regular').addClass('fa-solid');
                } else {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
    });
}

/**
 * Renders a single favorite item for the popup
 * @param {Object} favItem The favorite item to render
 * @param {number} index Index of the item (used for pagination)
 * @returns {string} HTML string for the favorite item
 */
function renderFavoriteItem(favItem, index) {
    if (!favItem) return '';
    
    const context = getContext();
    const message = context.chat.find(msg => msg.id == favItem.messageId);
    
    let previewText = '';
    let deletedClass = '';
    
    if (message) {
        // Get a preview of the message content (truncated if long)
        previewText = message.mes;
        if (previewText.length > 100) {
            previewText = previewText.substring(0, 100) + '...';
        }
        // Format message text
        previewText = messageFormatting(previewText, favItem.sender, false, 
                                        favItem.role === 'user', null, {}, false);
    } else {
        previewText = '[消息已删除]';
        deletedClass = 'deleted';
    }
    
    // Format timestamp
    const formattedTime = timestampToMoment(favItem.timestamp).format('YYYY-MM-DD HH:mm');
    
    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}" data-index="${index}">
            <div class="fav-meta">${favItem.sender} (${favItem.role}) - ${formattedTime}</div>
            <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">备注：${favItem.note || ''}</div>
            <div class="fav-preview ${deletedClass}">${previewText}</div>
            <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
}

/**
 * Updates the favorites popup with current data
 */
function updateFavoritesPopup() {
    if (!favoritesPopup || !ensureFavoritesArrayExists()) return;
    
    const context = getContext();
    const chatName = context.characterId ? context.name2 : `群组: ${context.groups.find(g => g.id === context.groupId)?.name || '未命名群组'}`;
    const totalFavorites = window.chat_metadata.favorites.length;
    
    // Sort favorites by timestamp (oldest first)
    const sortedFavorites = [...window.chat_metadata.favorites].sort((a, b) => a.timestamp - b.timestamp);
    
    // Pagination
    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFavorites);
    const currentPageItems = sortedFavorites.slice(startIndex, endIndex);
    
    // Build content for the popup
    let content = `
        <div class="favorites-popup-content">
            <div class="favorites-header">
                <h3>${chatName} - ${totalFavorites} 条收藏</h3>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;
    
    // Check if we have any favorites
    if (totalFavorites === 0) {
        content += `<div class="favorites-empty">当前没有收藏的消息。点击消息右下角的星形图标来添加收藏。</div>`;
    } else {
        // Add each favorite item
        currentPageItems.forEach((favItem, index) => {
            content += renderFavoriteItem(favItem, startIndex + index);
        });
        
        // Add pagination controls if needed
        if (totalPages > 1) {
            content += `<div class="favorites-pagination">`;
            // Previous page button
            content += `<button class="menu_button pagination-prev" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
            // Page indicator
            content += `<span>${currentPage} / ${totalPages}</span>`;
            // Next page button
            content += `<button class="menu_button pagination-next" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
            content += `</div>`;
        }
    }
    
    content += `
            </div>
            <div class="favorites-footer">
                <button class="menu_button clear-invalid">清理无效收藏</button>
                <button class="menu_button close-popup">关闭</button>
            </div>
        </div>
    `;
    
    // Update popup content
    favoritesPopup.content = content;
    favoritesPopup.update();
}

/**
 * Opens or updates the favorites popup
 */
function showFavoritesPopup() {
    if (!favoritesPopup) {
        // Create a new popup if it doesn't exist
        favoritesPopup = new Popup('收藏消息', '');
        favoritesPopup.width = 600;
        
        // Set up event delegation for popup interactions
        favoritesPopup.popup.addEventListener('click', function(event) {
            const target = $(event.target);
            
            // Handle pagination
            if (target.hasClass('pagination-prev')) {
                if (currentPage > 1) {
                    currentPage--;
                    updateFavoritesPopup();
                }
            } else if (target.hasClass('pagination-next')) {
                const totalPages = Math.ceil((window.chat_metadata.favorites || []).length / itemsPerPage);
                if (currentPage < totalPages) {
                    currentPage++;
                    updateFavoritesPopup();
                }
            } 
            // Handle close button
            else if (target.hasClass('close-popup')) {
                favoritesPopup.hide();
            } 
            // Handle clear invalid button
            else if (target.hasClass('clear-invalid')) {
                handleClearInvalidFavorites();
            } 
            // Handle edit note (pencil icon)
            else if (target.hasClass('fa-pencil')) {
                const favItem = target.closest('.favorite-item');
                const favId = favItem.data('fav-id');
                handleEditNote(favId);
            } 
            // Handle delete favorite (trash icon)
            else if (target.hasClass('fa-trash')) {
                const favItem = target.closest('.favorite-item');
                const favId = favItem.data('fav-id');
                const msgId = favItem.data('msg-id');
                handleDeleteFavoriteFromPopup(favId, msgId);
            }
        });
    }
    
    // Reset to first page when opening
    currentPage = 1;
    // Update popup content
    updateFavoritesPopup();
    // Show the popup
    favoritesPopup.show();
}

/**
 * Handles the deletion of a favorite from the popup
 * @param {string} favId The favorite ID
 * @param {string} messageId The message ID
 */
async function handleDeleteFavoriteFromPopup(favId, realMessageId) { // 重命名参数以示清晰
    const confirmResult = await callGenericPopup('确定要删除这条收藏吗？', POPUP_TYPE.CONFIRM);

    if (confirmResult === POPUP_RESULT.YES) {
        if (removeFavoriteById(favId)) { // removeFavoriteById 使用 favId，是正确的
            updateFavoritesPopup(); // 更新弹窗

            // --- 关键修改：更新聊天中的图标 ---
            const context = getContext();
            // 找到具有此 realMessageId 的消息的索引 (mesid)
            const messageIndex = context.chat.findIndex(msg => msg.id === realMessageId);

            if (messageIndex !== -1) {
                // 使用索引 (mesid) 来定位 DOM 元素
                const messageElement = $(`#chat .mes[mesid="${messageIndex}"]`);
                if (messageElement.length) {
                    const iconElement = messageElement.find('.favorite-toggle-icon i');
                    if (iconElement.length) {
                        iconElement.removeClass('fa-solid').addClass('fa-regular');
                    }
                }
            } else {
                console.warn(`${pluginName}: Could not find message index for realMessageId ${realMessageId} to update icon.`);
            }
        }
    }
}

/**
 * Handles editing the note for a favorite
 * @param {string} favId The favorite ID
 */
async function handleEditNote(favId) {
    if (!ensureFavoritesArrayExists()) return;
    
    const favorite = window.chat_metadata.favorites.find(fav => fav.id === favId);
    if (!favorite) return;
    
    const result = await callGenericPopup('为这条收藏添加备注:', POPUP_TYPE.INPUT, favorite.note || '');
    
    if (result !== null && typeof result === 'string') {
        updateFavoriteNote(favId, result);
        updateFavoritesPopup();
    }
}

/**
 * Clears invalid favorites (those referencing deleted messages)
 */
async function handleClearInvalidFavorites() {
    if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites.length) {
        await callGenericPopup('当前没有收藏项可清理。', POPUP_TYPE.TEXT);
        return;
    }
    
    const context = getContext();
    const invalidFavorites = [];
    
    // Find all invalid favorites (those referencing deleted messages)
    window.chat_metadata.favorites.forEach(fav => {
        const message = context.chat.find(msg => msg.id == fav.messageId);
        if (!message) {
            invalidFavorites.push(fav);
        }
    });
    
    if (invalidFavorites.length === 0) {
        await callGenericPopup('没有找到无效的收藏项。', POPUP_TYPE.TEXT);
        return;
    }
    
    const confirmResult = await callGenericPopup(
        `发现 ${invalidFavorites.length} 条引用已删除消息的收藏项。确定要删除这些无效收藏吗？`, 
        POPUP_TYPE.CONFIRM
    );
    
    if (confirmResult === POPUP_RESULT.YES) {
        // Filter out invalid favorites
        window.chat_metadata.favorites = window.chat_metadata.favorites.filter(fav => {
            const message = context.chat.find(msg => msg.id == fav.messageId);
            return !!message;
        });
        
        saveMetadataDebounced();
        
        await callGenericPopup(`已成功清理 ${invalidFavorites.length} 条无效收藏。`, POPUP_TYPE.TEXT);
        updateFavoritesPopup();
    }
}

/**
 * Main entry point for the plugin
 */
jQuery(async () => {
    try {
        console.log(`${pluginName}: 插件加载中...`);
        
        // Add button to the data bank wand container
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            console.log(`${pluginName}: 已将按钮添加到 #data_bank_wand_container`);
            
            // Bind click event to the button
            $('#favorites_button').on('click', () => {
                showFavoritesPopup();
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }
        
        // Add settings to extension settings
        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            $('#translation_container').append(settingsHtml);
            console.log(`${pluginName}: 已将设置 UI 添加到 #translation_container`);
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }
        
        // Set up event delegation for favorite toggle icon
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);
        
        // Initialize favorites array for current chat
        ensureFavoritesArrayExists();
        
        // Add favorite icons to existing messages and update their state
        addFavoriteIconsToMessages();
        refreshFavoriteIconsInView();
        
        // Set up event listeners
        // Listen for chat change events
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`${pluginName}: 聊天已更改，更新收藏图标...`);
            ensureFavoritesArrayExists();
            // Give DOM time to update with new messages
            setTimeout(() => {
                addFavoriteIconsToMessages();
                refreshFavoriteIconsInView();
            }, 100);
        });
        
        // Listen for message deletion
        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageId) => {
            if (!ensureFavoritesArrayExists() || !window.chat_metadata.favorites.length) return;
            
            const favIndex = window.chat_metadata.favorites.findIndex(fav => fav.messageId === deletedMessageId);
            
            if (favIndex !== -1) {
                console.log(`${pluginName}: 消息 ${deletedMessageId} 已被删除，删除对应的收藏项`);
                
                window.chat_metadata.favorites.splice(favIndex, 1);
                saveMetadataDebounced();
                
                if (favoritesPopup && favoritesPopup.isVisible()) {
                    updateFavoritesPopup();
                }
            }
        });
        
        // Listen for new messages being received or sent
        eventSource.on(event_types.MESSAGE_RECEIVED, () => {
            setTimeout(() => addFavoriteIconsToMessages(), 100);
        });
        
        eventSource.on(event_types.MESSAGE_SENT, () => {
            setTimeout(() => addFavoriteIconsToMessages(), 100);
        });
        
        // Listen for messages being updated
        eventSource.on(event_types.MESSAGE_UPDATED, () => {
            setTimeout(() => addFavoriteIconsToMessages(), 100);
        });
        
        // Listen for more messages loaded
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
            setTimeout(() => {
                addFavoriteIconsToMessages();
                refreshFavoriteIconsInView();
            }, 100);
        });
        
        // Also add observer for dynamic changes to chat
        const chatObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    // New elements were added, check if they're messages
                    setTimeout(() => addFavoriteIconsToMessages(), 50);
                }
            }
        });
        
        // Start observing the chat container
        chatObserver.observe(document.getElementById('chat'), { 
            childList: true, 
            subtree: true 
        });
        
        console.log(`${pluginName}: 插件加载完成!`);
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});

/**
 * Debounced version of saveMetadata
 */
function saveMetadataDebounced() {
    const context = getContext();
    context.saveMetadata();
}
