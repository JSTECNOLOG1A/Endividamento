import React from "react";
import CurrencyInputField from "react-currency-input-field";
import { cn } from "@/lib/utils";

const CurrencyInput = React.forwardRef(
  ({ type = "currency", value, onChange, placeholder, className, disabled, ...props }, ref) => {
    const config = {
      currency: {
        decimalScale: 2,
        decimalsLimit: 2
      },
      percent: {
        decimalScale: 4,
        decimalsLimit: 6
      },
      exchange_rate: {
        decimalScale: 4,
        decimalsLimit: 4
      }
    };

    const currentConfig = config[type] || config.currency;

    const handleValueChange = (rawValue) => {
      if (onChange) {
        onChange({
          target: {
            value: rawValue || ""
          }
        });
      }
    };

    return (
      <CurrencyInputField
        ref={ref}
        value={value}
        onValueChange={handleValueChange}
        decimalsLimit={currentConfig.decimalsLimit}
        decimalScale={currentConfig.decimalScale}
        groupSeparator="."
        decimalSeparator=","
        allowNegativeValue={false}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
          "font-mono"
        )}
        {...props}
      />
    );
  }
);

CurrencyInput.displayName = "CurrencyInput";

export { CurrencyInput };