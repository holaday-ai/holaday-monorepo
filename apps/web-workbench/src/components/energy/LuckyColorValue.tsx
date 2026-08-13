import { presentLuckyColor } from './lucky-color';

interface LuckyColorValueProps {
  value: string | null | undefined;
  fallback?: string;
}

export function LuckyColorValue({
  value,
  fallback,
}: LuckyColorValueProps): JSX.Element {
  const color = presentLuckyColor(value, fallback);

  return (
    <span className="energy-lucky-color-value">
      {color.swatch ? (
        <i
          className="energy-lucky-color-swatch"
          aria-hidden="true"
          title={color.swatch}
          style={{ backgroundColor: color.swatch }}
        />
      ) : null}
      <span>{color.label}</span>
    </span>
  );
}
