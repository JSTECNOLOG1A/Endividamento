import { apiRequest } from "./base44Client";

export const pricingConfigApi = {
  get() {
    return apiRequest("/pricing-config");
  },
  update(data) {
    return apiRequest("/pricing-config", { method: "PUT", body: data });
  },
};
