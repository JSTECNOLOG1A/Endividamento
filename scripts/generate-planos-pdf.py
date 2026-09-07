#!/usr/bin/env python3
"""Gera docs/billing/PLANOS-ALLDEBT.pdf a partir da definição oficial dos planos."""
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "billing" / "PLANOS-ALLDEBT.pdf"
FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"

PLANS = [
    {
        "name": "Starter",
        "tagline": "Operação enxuta e período de avaliação",
        "limits": "10 contratos ativos / 3 usuários",
        "support": "E-mail / horário comercial",
        "includes": [
            "Calculadora de endividamento",
            "Contratos (cadastro e fluxo básico)",
            "Indexadores e feriados",
            "Manual e configurações essenciais",
            "Exportações básicas",
        ],
        "excludes": [
            "Contabilidade / consolidação",
            "Financeiro (AP/AR)",
            "Governança avançada e ERP",
            "SLA e suporte dedicado",
        ],
    },
    {
        "name": "Pro",
        "tagline": "Operação completa para times financeiros",
        "limits": "50 contratos ativos / 10 usuários",
        "support": "E-mail prioritário / horário comercial ampliado",
        "includes": [
            "Tudo do Starter",
            "Contas garantidas, Governança",
            "Contabilidade e Consolidação",
            "Financeiro (contas a pagar / receber)",
            "Integrações ERP (Protheus) no onboarding",
            "Parâmetros e auditoria operacional do tenant",
        ],
        "excludes": [
            "Limites ilimitados",
            "SLA / CSM dedicado",
            "Customizações sob contrato Enterprise",
        ],
    },
    {
        "name": "Enterprise",
        "tagline": "Escala, governança e suporte dedicado",
        "limits": "Contratos ilimitados / usuários ilimitados",
        "support": "Canal dedicado / SLA sob contrato",
        "includes": [
            "Tudo do Pro",
            "Operação multi-filial em escala",
            "Onboarding assistido",
            "Suporte dedicado e SLA",
            "Acesso assistido PLATFORM MASTER (auditado)",
            "Prioridade em customizações contratadas",
        ],
        "excludes": [],
    },
]


class Pdf(FPDF):
    def footer(self):
        self.set_y(-15)
        self.set_font("Body", size=8)
        self.set_text_color(120, 120, 120)
        self.cell(
            0,
            8,
            f"AllDebt — Planos comerciais v1.0 — 2026-09-07 — página {self.page_no()}",
            align="C",
        )


def write_line(pdf: Pdf, text: str, size=10, bold=False, color=(50, 50, 50), h=5):
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Body", style="B" if bold else "", size=size)
    pdf.set_text_color(*color)
    pdf.multi_cell(pdf.epw, h, text)


def main():
    pdf = Pdf(format="A4")
    pdf.set_margins(18, 18, 18)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_font("Body", "", FONT)
    pdf.add_font("Body", "B", FONT)
    pdf.add_page()

    write_line(pdf, "AllDebt — Planos comerciais", size=18, bold=True, color=(21, 94, 239), h=10)
    write_line(
        pdf,
        "Definição oficial da diferença entre Starter, Pro e Enterprise. "
        "Limites de contratos e usuários são aplicados no backend. "
        "Documento complementar: docs/billing/PLANOS-ALLDEBT.md",
        size=11,
        color=(80, 80, 80),
        h=6,
    )
    pdf.ln(4)

    write_line(pdf, "Resumo", size=12, bold=True, color=(20, 20, 20), h=8)
    headers = ["", "Starter", "Pro", "Enterprise"]
    widths = [40, 48, 48, 48]
    pdf.set_fill_color(241, 245, 249)
    pdf.set_font("Body", "B", 9)
    pdf.set_text_color(30, 30, 30)
    pdf.set_x(pdf.l_margin)
    for h, w in zip(headers, widths):
        pdf.cell(w, 7, h, border=1, fill=True)
    pdf.ln()
    rows = [
        ["Contratos", "10", "50", "Ilimitado"],
        ["Usuários", "3", "10", "Ilimitado"],
        ["Suporte", "E-mail", "Prioritário", "SLA dedicado"],
        ["Foco", "Trial / enxuto", "Time financeiro", "Escala corporativa"],
    ]
    pdf.set_font("Body", "", 9)
    for row in rows:
        pdf.set_x(pdf.l_margin)
        for cell, w in zip(row, widths):
            pdf.cell(w, 7, cell, border=1)
        pdf.ln()
    pdf.ln(6)

    for plan in PLANS:
        write_line(pdf, plan["name"], size=14, bold=True, color=(21, 94, 239), h=8)
        write_line(pdf, plan["tagline"], size=10, color=(60, 60, 60), h=5)
        write_line(pdf, f"Limites: {plan['limits']}", size=10, bold=True, color=(30, 30, 30), h=6)
        write_line(pdf, f"Suporte: {plan['support']}", size=10, color=(50, 50, 50), h=6)
        write_line(pdf, "Inclui", size=10, bold=True, color=(30, 30, 30), h=6)
        for item in plan["includes"]:
            write_line(pdf, f"-  {item}", size=10, color=(50, 50, 50), h=5)
        if plan["excludes"]:
            write_line(pdf, "Não inclui", size=10, bold=True, color=(30, 30, 30), h=6)
            for item in plan["excludes"]:
                write_line(pdf, f"-  {item}", size=10, color=(50, 50, 50), h=5)
        pdf.ln(3)

    write_line(pdf, "Enforcement técnico", size=12, bold=True, color=(20, 20, 20), h=8)
    write_line(
        pdf,
        "- Limites: backend/src/modules/tenants/policy.js\n"
        "- Catálogo: backend/src/modules/billing/plans.js\n"
        "- Alteração de plano: somente PLATFORM MASTER\n"
        "- Auditoria: TENANT_PLAN_CHANGED\n"
        "- A matriz de módulos é a definição comercial oficial; "
        "gates de menu por plano podem ser endurecidos progressivamente.",
        size=10,
        color=(50, 50, 50),
        h=5,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
