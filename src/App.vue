<script setup lang="ts">
import {
  NConfigProvider,
  zhCN,
  dateZhCN,
  GlobalThemeOverrides,
} from "naive-ui";
import ConfigCard from "./components/ConfigCard.vue";

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#646cff",
    primaryColorHover: "#646cff",
    primaryColorPressed: "#646cff",
  },
};
</script>

<template>
  <n-config-provider
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="themeOverrides"
  >
    <ConfigCard />
  </n-config-provider>
</template>

<style scoped></style>
