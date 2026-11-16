import { PAYMENT_TYPE_LABELS, type PaymentType } from '../../../src/types/serviceAgreement';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * How the customer pays, as a row of check boxes. One box is ticked at a
 * time: ticking another moves the tick. Only credit card and Visa debit are
 * charged automatically and count toward "outstanding".
 */
export function PaymentTypeChecks({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: PaymentType | null;
  options: readonly PaymentType[];
  onChange: (type: PaymentType) => void;
}): JSX.Element {
  return (
    <div role="group" aria-label="Payment type" className="flex flex-wrap gap-x-4 gap-y-2 py-1">
      {options.map((type) => (
        <label key={type} htmlFor={`${id}-${type}`} className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            id={`${id}-${type}`}
            checked={value === type}
            onCheckedChange={(checked) => {
              if (checked) onChange(type);
            }}
          />
          {PAYMENT_TYPE_LABELS[type]}
        </label>
      ))}
    </div>
  );
}
