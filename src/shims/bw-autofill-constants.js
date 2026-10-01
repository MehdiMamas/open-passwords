export const FormPurposeCategories = {
  AccountLogin: "account-login",
  PaymentCard: "payment-card",
  Identity: "identity",
  Address: "address",
};

export const AutofillTargetingRuleTypes = new Proxy(
  {},
  {
    get(_target, key) {
      return typeof key === "string" ? key : undefined;
    },
  },
);
