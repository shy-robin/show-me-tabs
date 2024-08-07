<template>
  <div class="config-card">
    <div class="config-card__header">配置</div>
    <div class="config-card__body">
      <div class="config-card__item">
        <div class="config-card__item-label">单窗口标签最大显示数量</div>
        <n-input-number
          v-model:value="maxTabsCount"
          size="small"
          :min="1"
          :max="100"
          :update-value-on-input="false"
          @update:value="handleMaxTabsCountChange"
        />
      </div>
      <div class="config-card__item">
        <div class="config-card__item-label">标签整理规则</div>
        <n-select
          v-model:value="rule"
          size="small"
          :options="ruleOptions"
          @update:value="handleRuleChange"
        />
      </div>
      <div class="config-card__item">
        <div class="config-card__item-label">分组文案</div>
        <n-input
          v-model:value="groupLabel"
          clearable
          size="small"
          @update:value="handleGroupLabelChange"
        />
      </div>
      <div class="config-card__item">
        <div class="config-card__item-label">分组颜色</div>
        <n-select
          v-model:value="groupColor"
          size="small"
          :options="groupColorOptions"
          @update:value="handleGroupColorChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { NInputNumber, NInput, NSelect, useMessage } from "naive-ui";

const Message = useMessage();

const maxTabsCount = ref(7);
const groupLabel = ref("MORE");
const groupColor = ref("blue");
const rule = ref("lastAccessed");

const ruleOptions = [
  {
    label: "最近访问时间",
    value: "lastAccessed",
  },
];
const groupColorOptions = [
  {
    label: "灰",
    value: "grey",
  },
  {
    label: "蓝",
    value: "blue",
  },
  {
    label: "红",
    value: "red",
  },
  {
    label: "黄",
    value: "yellow",
  },
  {
    label: "green",
    value: "绿",
  },
  {
    label: "粉",
    value: "pink",
  },
  {
    label: "紫",
    value: "purple",
  },
  {
    label: "青",
    value: "cyan",
  },
  {
    label: "橙",
    value: "orange",
  },
];

const sendMessage = (
  event:
    | "update:maxTabsCount"
    | "update:groupLabel"
    | "update:groupColor"
    | "update:rule",
  val: any
) => {
  chrome.runtime.sendMessage({ event, val }, (response) => {
    if (response) {
      Message.success("操作成功");
    } else {
      Message.error("操作失败");
    }
  });
};

const handleMaxTabsCountChange = (val: number | null) => {
  if (val === null) {
    maxTabsCount.value = 1;
    return;
  }
  sendMessage("update:maxTabsCount", val);
};
const handleRuleChange = (val: string) => {
  sendMessage("update:rule", val);
};
const handleGroupLabelChange = (val: string) => {
  sendMessage("update:groupLabel", val);
};
const handleGroupColorChange = (val: string) => {
  sendMessage("update:groupColor", val);
};
</script>

<style lang="less" scoped>
.config-card {
  width: 100%;
  color: #000;
  &__header {
    color: #fff;
    background-color: #646cff;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    border-bottom: none;
    font-size: 14px;
    padding: 4px;
  }
  &__body {
    border: 1px solid #ddd;
    border-top: none;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
    padding: 8px;
  }
  &__item {
    text-align: start;
    margin-bottom: 8px;
    &-label {
      color: #747bff;
      font-size: 12px;
      margin-bottom: 8px;
    }
  }
}
</style>
