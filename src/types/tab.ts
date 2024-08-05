export type Bucket = Map<number, WindowInfo>;

export interface WindowInfo {
  groupId: number | undefined;
  lastPinnedIndex: number;
  tabInfoMap: Map<number, TabInfo>;
}

export interface TabInfo {
  lastAccessed: number;
}
