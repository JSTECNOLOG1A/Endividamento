import { toast as sonnerToast } from "sonner";

const KIND = {
  success: { title: "Tudo certo", duration: 4000 },
  error: { title: "Algo deu errado", duration: 7000 },
  warning: { title: "Atenção", duration: 5500 },
  info: { title: "Informação", duration: 5000 },
};

function show(type, message, options = {}) {
  const kind = KIND[type];
  const { title, duration, description, ...rest } = options;
  const nextDuration = duration ?? kind.duration;
  const hasDescription = description != null && description !== "";

  if (hasDescription) {
    return sonnerToast[type](message, { duration: nextDuration, description, ...rest });
  }

  return sonnerToast[type](title || kind.title, {
    ...rest,
    description: message,
    duration: nextDuration,
  });
}

export const toast = Object.assign((message, options) => sonnerToast(message, options), {
  success: (message, options) => show("success", message, options),
  error: (message, options) => show("error", message, options),
  warning: (message, options) => show("warning", message, options),
  info: (message, options) => show("info", message, options),
  message: sonnerToast.message,
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
  loading: sonnerToast.loading,
  custom: sonnerToast.custom,
});
