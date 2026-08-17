"use client";

export function ConfirmSubmitForm({
  action,
  confirmMessage,
  hiddenName,
  hiddenValue,
  buttonLabel,
  className,
}: {
  action: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  hiddenName: string;
  hiddenValue: string | number;
  buttonLabel: string;
  className?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <input type="hidden" name={hiddenName} value={hiddenValue} />
      <button type="submit" className={className ?? "btn-danger"}>
        {buttonLabel}
      </button>
    </form>
  );
}
