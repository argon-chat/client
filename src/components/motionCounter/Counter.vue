<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";

import Digit from "./Digit.vue";

interface CounterProps {
    value: number;
    fontSize?: number;
    padding?: number;
    places?: number[];
    gap?: number;
    borderRadius?: number;
    horizontalPadding?: number;
    textColor?: string;
    fontWeight?: CSSProperties["fontWeight"];
    containerStyle?: CSSProperties;
    counterStyle?: CSSProperties;
    digitStyle?: CSSProperties;
    gradientHeight?: number;
    gradientFrom?: string;
    gradientTo?: string;
    topGradientStyle?: CSSProperties;
    bottomGradientStyle?: CSSProperties;
}

const props = withDefaults(defineProps<CounterProps>(), {
    fontSize: 100,
    padding: 0,
    places: () => [100, 10, 1],
    gap: 8,
    borderRadius: 4,
    horizontalPadding: 2,
    textColor: "white",
    fontWeight: "bold",
    gradientHeight: 16,
    gradientFrom: "transparent",
    gradientTo: "transparent"
});

const height = computed(() => props.fontSize + props.padding);
</script>

<template>
    <!-- container -->
    <div :style="{
        position: 'relative',
        display: 'inline-block',
        ...(containerStyle ?? {})
    }">
        <!-- counter -->
        <div :style="{
            fontSize: fontSize + 'px',
            display: 'flex',
            gap: gap + 'px',
            overflow: 'hidden',
            borderRadius: borderRadius + 'px',
            paddingLeft: horizontalPadding + 'px',
            paddingRight: horizontalPadding + 'px',
            lineHeight: 1,
            color: textColor,
            fontWeight,
            ...(counterStyle ?? {})
        }">
            <Digit v-for="place in places" :key="place" :place="place" :value="value" :height="height"
                :digitStyle="digitStyle" />
        </div>

        <!-- gradients -->
        <div :style="{
            pointerEvents: 'none',
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
        }">
            <!-- top -->
            <div :style="topGradientStyle ??
            {
                height: gradientHeight + 'px',
                background: `linear-gradient(to bottom, ${gradientFrom}, ${gradientTo})`
            }
                " />
            <!-- bottom -->
            <div :style="bottomGradientStyle ??
            {
                position: 'absolute',
                bottom: 0,
                width: '100%',
                height: gradientHeight + 'px',
                background: `linear-gradient(to top, ${gradientFrom}, ${gradientTo})`
            }
                " />
        </div>
    </div>
</template>
