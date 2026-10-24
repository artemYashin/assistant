import {
  forwardRef,
  useState,
  useRef,
  useLayoutEffect,
  type InputHTMLAttributes,
} from "react";

type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue"
> & {
  value: string | number;
};

/** Keep the editable text separate from the number normalized by the consumer. */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      value,
      step,
      min,
      onChange,
      onFocus,
      onBlur,
      onKeyDown,
      onPaste,
      ...props
    },
    ref,
  ) {
    const [draft, setDraft] = useState<string | null>(null);
    const changedHere = useRef(false);
    const previousValue = useRef(value);
    useLayoutEffect(() => {
      if (!changedHere.current && previousValue.current !== value)
        setDraft(null);
      previousValue.current = value;
      changedHere.current = false;
    });
    const decimal =
      step === "any" || (step !== undefined && Number(step) % 1 !== 0);
    const negative = min === undefined || Number(min) < 0;
    const allowed = (text: string) =>
      (decimal ? /^-?\d*(?:\.\d*)?$/ : /^-?\d*$/).test(text) &&
      (negative || !text.includes("-"));

    return (
      <input
        {...props}
        ref={ref}
        type="number"
        step={step}
        min={min}
        inputMode={decimal ? "decimal" : "numeric"}
        value={draft ?? String(value)}
        onFocus={(event) => {
          setDraft(event.currentTarget.value);
          onFocus?.(event);
        }}
        onChange={(event) => {
          if (!allowed(event.currentTarget.value)) return;
          changedHere.current = true;
          setDraft(event.currentTarget.value);
          onChange?.(event);
        }}
        onBlur={(event) => {
          setDraft(null);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          // Preserve navigation, shortcuts, native stepping and form submission.
          if (
            event.defaultPrevented ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.nativeEvent.isComposing
          )
            return;
          if (event.key.length === 1 && !allowed(event.key))
            event.preventDefault();
        }}
        onPaste={(event) => {
          onPaste?.(event);
          if (!allowed(event.clipboardData.getData("text")))
            event.preventDefault();
        }}
      />
    );
  },
);
