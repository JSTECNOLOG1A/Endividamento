import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { Toaster as Sonner } from "sonner";

export function Toaster(props) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      richColors
      closeButton
      duration={4500}
      visibleToasts={4}
      gap={12}
      offset={20}
      mobileOffset={16}
      toastOptions={{
        closeButtonAriaLabel: "Fechar notificação",
        classNames: {
          toast: "font-sans",
          title: "text-[13.5px] font-semibold leading-snug",
          description: "text-[12.5px] leading-relaxed opacity-90",
        },
      }}
      icons={{
        success: <CheckCircle2 className="size-5" strokeWidth={2.2} />,
        error: <CircleAlert className="size-5" strokeWidth={2.2} />,
        warning: <TriangleAlert className="size-5" strokeWidth={2.2} />,
        info: <Info className="size-5" strokeWidth={2.2} />,
        close: <X className="size-3.5" strokeWidth={2.4} />,
      }}
      {...props}
    />
  );
}
