import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Toast from "@/components/arc/toast/toast";

interface ToastMessage {
  id: number;
  title: string;
  description?: string;
}

const ToastContext = createContext<(title: string, description?: string) => void>(() => undefined);

/** Brief notices for work that finished in the background, such as a file landing in Downloads. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const [open, setOpen] = useState(false);

  const notify = useCallback((title: string, description?: string) => {
    setMessage((previous) => ({ id: (previous?.id ?? 0) + 1, title, description }));
    setOpen(true);
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toastHost">
        {message ? <Toast key={message.id} title={message.title} description={message.description} open={open} onOpenChange={setOpen} /> : null}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
