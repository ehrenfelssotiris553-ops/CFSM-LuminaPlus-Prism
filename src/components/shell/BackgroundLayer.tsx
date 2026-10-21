import { useEffect } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { refreshCanvasColors } from "@/hooks/useMetricColors";
import {
  applySurfaceCache,
  buildSurfaceCache,
  persistSurfaceCache,
} from "@/utils/background";
import { applySkinStyle, persistSkinStyle, skinStyleOf, type SkinStyle } from "@/utils/skin";

/** 写配色风格到 <html>；真的变了就让画布图表重取颜色。设置页实时预览也走这里。 */
export function applySkin(style: SkinStyle) {
  if (applySkinStyle(style)) refreshCanvasColors();
}

/**
 * 同步卡片透明度、配色风格相关的 CSS 变量与首帧缓存。
 *
 * 背景图由 CF-Server-Monitor 后台外观设置直接注入到 `<body>`，主题不再自己加载背景图。
 */
export function BackgroundLayer() {
  const { surfaceOpacity, isReady, skin, skinAccent, skinRadius, skinDensity, skinNumericFont } =
    useThemeSettings();

  useEffect(() => {
    if (!isReady) return;
    const cache = buildSurfaceCache(surfaceOpacity);
    persistSurfaceCache(cache);
    applySurfaceCache(cache);
  }, [isReady, surfaceOpacity]);

  useEffect(() => {
    if (!isReady) return;
    const style = skinStyleOf({ skin, skinAccent, skinRadius, skinDensity, skinNumericFont });
    persistSkinStyle(style);
    applySkin(style);
  }, [isReady, skin, skinAccent, skinRadius, skinDensity, skinNumericFont]);

  return null;
}
