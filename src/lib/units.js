const C_TO_F = 9 / 5;

export function celsiusToFahrenheit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value * C_TO_F + 32;
}

export function formatFahrenheit(value) {
  const fahrenheit = celsiusToFahrenheit(value);
  return fahrenheit === null ? null : `${Math.round(fahrenheit)}°F`;
}
