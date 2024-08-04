// BUG:
// 取消分组，无法触发
// 附加或分离标签页，无法触发
// 新窗口增加 tab 会影响旧窗口
// 多窗口
// 长时间不使用会重新分组，可能是销毁了变量，可能是 groupId 变化了
// 将标签页移出分组或者移入分组会有问题

// TODO:
// 收缩其他自定义组

import { TabInfo } from "./types/tab";

class TabManager {
  private groupId: number | undefined;
  private currentWindowId = -1;
  private maxTabsCount = 3;
  private tabInfoMap: Map<number, TabInfo> = new Map();

  constructor() {
    this.handleTabsChange();
    this.initListener();
  }

  async handleTabsChange() {
    const currentWindow = await chrome.windows.getCurrent();
    this.currentWindowId = currentWindow.id ?? -1;

    const { ungroupedTabs } = await this.getTabsInfo();
    const ungroupedTabsCount = ungroupedTabs.length;

    if (ungroupedTabsCount === 0) {
      return;
    }
    if (ungroupedTabsCount > this.maxTabsCount) {
      this.handleTabsOverThreshold(ungroupedTabs);
      return;
    }
    this.handleTabsBelowThreshold();
  }

  async initListener() {
    // 创建标签页时触发
    chrome.tabs.onCreated.addListener(() => {
      this.handleTabsChange();
    });
    // 在标签页关闭时触发。
    chrome.tabs.onRemoved.addListener(() => {
      this.handleTabsChange();
    });
    // 在窗口中的活动标签页发生变化时触发。
    chrome.tabs.onActivated.addListener(() => {
      this.handleActivateGroupedTabs();
    });
    chrome.windows.onFocusChanged.addListener((windowId) => {
      this.currentWindowId = windowId;
    });
    chrome.tabGroups.onRemoved.addListener((tabGroup) => {
      const { id } = tabGroup;
      if (id === this.groupId) {
        this.groupId = undefined;
      }
    });
  }

  async getTabsInfo() {
    const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
    // 更新标签的上一次访问时间
    currentWindowTabs.forEach((tab) => {
      const { id, lastAccessed } = tab;
      if (id && lastAccessed) {
        const info = this.tabInfoMap.get(id) ?? {};
        this.tabInfoMap.set(id, {
          ...info,
          lastAccessed,
        });
      }
    });
    const ungroupedTabs = currentWindowTabs.filter(
      (tab) => tab.groupId < 0 && !tab.pinned
    );

    return {
      currentWindowTabs,
      ungroupedTabs,
    };
  }

  /**
   * 处理标签页超过阈值的情况
   */
  async handleTabsOverThreshold(ungroupedTabs: chrome.tabs.Tab[]) {
    // FIXME: 如果用户已经创建分组怎么办？ 如果用户有多个分组怎么办？

    // NOTE: 当标签页移动后，lastAccessed 会变为 undefined
    const originalTabs = ungroupedTabs.slice().map((tab) => ({
      ...tab,
      lastAccessed:
        tab.lastAccessed ||
        this.tabInfoMap.get(tab.id ?? -1)?.lastAccessed ||
        0,
    }));
    console.log(
      "before",
      originalTabs.map((item) => ({
        title: item.title,
        lastAccessed: item.lastAccessed,
      }))
    );
    // 需要移入分组的标签页 id
    const tabIds = originalTabs
      .sort((a, b) => a.lastAccessed - b.lastAccessed)
      .slice(0, ungroupedTabs.length - this.maxTabsCount)
      .map((tab) => tab.id ?? -1);
    console.log(
      "after",
      originalTabs
        .sort((a, b) => a.lastAccessed - b.lastAccessed)
        .map((item) => ({
          title: item.title,
          lastAccessed: item.lastAccessed,
        }))
    );
    console.log("over");
    console.log("groupId", this.groupId);
    console.log("currentWindowId", this.currentWindowId);
    // 创建分组
    this.groupTab(tabIds, this.groupId);
  }

  /**
   * 处理标签页低于阈值的情况
   */
  async handleTabsBelowThreshold() {
    if (!this.groupId) {
      return;
    }
    const groupedTabs = await chrome.tabs.query({
      groupId: this.groupId,
    });
    const lastTabInGroup = groupedTabs[groupedTabs.length - 1];
    if (!lastTabInGroup) {
      return;
    }
    if (lastTabInGroup.id) {
      await this.ungroupTab(groupedTabs, lastTabInGroup.id);
    }
  }

  /**
   * 移入或创建分组
   */
  async groupTab(tabIds: number | number[], groupId?: number) {
    console.log("==========");
    console.log(groupId);
    // 创建分组
    const newGroupId = await chrome.tabs.group({
      groupId,
      tabIds,
    });
    this.groupId = newGroupId;
    console.log(newGroupId);
    // 将分组移到首位
    await chrome.tabGroups.move(newGroupId, {
      index: 0,
    });
    // 更新分组的状态
    await chrome.tabGroups.update(newGroupId, {
      collapsed: true,
      color: "blue",
      title: "MORE",
    });
  }

  /**
   * 移出或销毁分组
   */
  async ungroupTab(groupedTabs: chrome.tabs.Tab[], tabId: number | number[]) {
    const onlyOneTab = groupedTabs.length === 1;
    await chrome.tabs.ungroup(tabId);
    if (onlyOneTab) {
      this.groupId = undefined;
    }
    if (this.groupId) {
      await chrome.tabGroups.move(this.groupId, {
        index: 0,
      });
    }
  }

  /**
   * 处理用户切换到分组标签页
   */
  async handleActivateGroupedTabs() {
    const { currentWindowTabs, ungroupedTabs } = await this.getTabsInfo();
    const currentActiveTab = currentWindowTabs.find((tab) => tab.active);
    if (!currentActiveTab || !currentActiveTab.id) {
      return;
    }
    const isGroupedTab = currentActiveTab.groupId === this.groupId;
    if (!isGroupedTab) {
      return;
    }
    // FIXME: why
    await new Promise((resolve) => {
      setTimeout(() => resolve(true), 100);
    });
    // 找到未分组标签页中最早访问的标签
    const groupedTabs = currentWindowTabs.filter(
      (tab) => tab.groupId === this.groupId
    );
    const originalTabs = ungroupedTabs.slice().map((tab) => ({
      ...tab,
      lastAccessed:
        tab.lastAccessed ||
        this.tabInfoMap.get(tab.id ?? -1)?.lastAccessed ||
        0,
    }));
    const [firstAccessedTab] = originalTabs;
    // 将选中标签页移出分组
    await this.ungroupTab(groupedTabs, currentActiveTab.id);
    // 将最早访问的标签移入分组
    firstAccessedTab.id && this.groupTab(firstAccessedTab.id, this.groupId);
  }
}

new TabManager();
