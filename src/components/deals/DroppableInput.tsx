import * as React from 'react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DroppableInputProps extends React.ComponentProps<'input'> {
  /** The field key this input accepts (e.g. 'grossPerPeriod', 'ytdGross') */
  acceptField: string;
  /** Called when a value is dropped */
  onDropValue?: (value: string) => void;
}

export const DroppableInput = React.forwardRef<HTMLInputElement, DroppableInputProps>(
  ({ acceptField, onDropValue, className, onChange, ...props }, ref) => {
    const [dragOver, setDragOver] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
      const types = e.dataTransfer.types;
      if (types.includes('application/x-income-field')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }
    };

    const handleDragLeave = () => setDragOver(false);

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      try {
        const raw = e.dataTransfer.getData('application/x-income-field');
        const payload = JSON.parse(raw) as { field: string; value: string; label: string };
        // Accept any numeric value drop onto numeric fields
        if (payload.value) {
          onDropValue?.(payload.value);
          // Also fire onChange for React-controlled inputs
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set;
          const input = e.currentTarget.querySelector('input') ?? e.currentTarget;
          if (input instanceof HTMLInputElement && nativeInputValueSetter) {
            nativeInputValueSetter.call(input, payload.value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      } catch {
        // ignore invalid drops
      }
    };

    return (
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative"
      >
        <Input
          ref={ref}
          className={cn(
            className,
            dragOver && 'ring-2 ring-primary ring-offset-1 border-primary bg-primary/5 transition-all'
          )}
          onChange={onChange}
          {...props}
        />
        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-md">
            <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
              Drop here
            </span>
          </div>
        )}
      </div>
    );
  }
);
DroppableInput.displayName = 'DroppableInput';
