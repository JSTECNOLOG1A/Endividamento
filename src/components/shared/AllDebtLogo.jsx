import logo from "@/assets/alldebt-logo.png";

export default function AllDebtLogo({ className = "h-8 w-auto" }) {
  return (
    <img
      src={logo}
      alt="AllDebt BACEN"
      className={className}
      decoding="async"
    />
  );
}
