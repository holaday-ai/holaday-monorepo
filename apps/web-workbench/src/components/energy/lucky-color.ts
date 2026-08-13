interface LuckyColorPresentation {
  label: string;
  swatch: string | null;
}

const HEX_COLOR_PATTERN = /^#([\da-f]{3}|[\da-f]{6})$/i;

export function presentLuckyColor(
  value: string | null | undefined,
  fallback = '等待提示',
): LuckyColorPresentation {
  const input = value?.trim();
  if (!input) return { label: fallback, swatch: null };

  const swatch = normalizeHexColor(input);
  if (!swatch) return { label: input, swatch: null };

  return {
    label: semanticColorName(swatch),
    swatch,
  };
}

function normalizeHexColor(value: string): string | null {
  const match = value.match(HEX_COLOR_PATTERN);
  if (!match) return null;

  const compact = match[1];
  const expanded =
    compact.length === 3
      ? compact
          .split('')
          .map((character) => character.repeat(2))
          .join('')
      : compact;
  return `#${expanded.toUpperCase()}`;
}

function semanticColorName(hex: string): string {
  const { hue, saturation, lightness } = hexToHsl(hex);

  if (lightness >= 0.94) return '月光白';
  if (lightness <= 0.12) return '墨黑';
  if (saturation <= 0.14) {
    if (lightness >= 0.72) return '银灰';
    if (lightness >= 0.42) return '雾灰';
    return '岩灰';
  }

  if (hue < 12 || hue >= 345) return lightness >= 0.68 ? '珊瑚粉' : '莓果红';
  if (hue < 40) return lightness >= 0.7 ? '蜜桃橙' : '金橙';
  if (hue < 70) return lightness >= 0.74 ? '奶油黄' : '琥珀金';
  if (hue < 165) return lightness >= 0.72 ? '薄荷绿' : '翡翠绿';
  if (hue < 200) return lightness >= 0.72 ? '海盐青' : '湖水青';
  if (hue < 250) return lightness >= 0.72 ? '天蓝' : '电光蓝';
  if (hue < 290) return lightness >= 0.72 ? '薰衣草紫' : '星云紫';
  if (hue < 345) return lightness >= 0.72 ? '柔粉' : '莓果粉';
  return '幸运色';
}

function hexToHsl(hex: string): {
  hue: number;
  saturation: number;
  lightness: number;
} {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;

  if (delta === 0) return { hue: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation,
    lightness,
  };
}
