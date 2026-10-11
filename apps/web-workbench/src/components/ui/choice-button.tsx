import * as React from 'react';

/** Native selectable button shared by segmented controls and option cards. */
export const ChoiceButton = React.forwardRef<HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<'button'>, 'aria-pressed'> & { selected: boolean }
>(({ selected, type = 'button', ...props }, ref) => (
  <button {...props} ref={ref} type={type} aria-pressed={selected} />
));
ChoiceButton.displayName = 'ChoiceButton';
