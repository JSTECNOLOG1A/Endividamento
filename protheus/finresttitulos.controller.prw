#include "totvs.ch"
#include "Restful.ch"

/*/{Protheus.doc} FinRestTitulos
Controller REST para inclusao de titulos financeiros.
Usa MsExecAuto FINA040 (receber / SE1) e FINA050 (pagar / SE2).
filial no JSON e E2_FILIAL (ex.: 03). filOrig e E2_FILORIG (ex.: 0301).
O grupo 01 define a tabela fisica SE2010. Nao existe campo empresa no SE2.
Ambiente REST (PrepareIn/OAuth), mesmo padrao do PecCodeEstoque: sem RpcSetEnv/FWSetSM0.

@author  Jean Oliveira
@since   04/08/2026
@type    class
/*/
WSRESTFUL FinRestTitulos DESCRIPTION "Inclusao de titulos financeiros - Contas a Receber e Contas a Pagar" FORMAT "application/json"

	WSDATA cPayload As Character

	WSMETHOD POST RECEBER DESCRIPTION "Inclui/estorna/consulta titulo a receber. Campo acao: incluir, estornar, consultar, clientes" ;
		PATH "/FinRestTitulos/receber" WSSYNTAX "/FinRestTitulos/receber"

	WSMETHOD POST ESTORNAE1 DESCRIPTION "Estorna titulo a receber sem movimentacao" ;
		PATH "/FinRestTitulos/estornarReceber" WSSYNTAX "/FinRestTitulos/estornarReceber"

	WSMETHOD POST SALDOSE1 DESCRIPTION "Consulta titulo a receber no SE1 (saldo, baixa, situacao)" ;
		PATH "/FinRestTitulos/consultarReceber" WSSYNTAX "/FinRestTitulos/consultarReceber"

	WSMETHOD POST CLIENTES DESCRIPTION "Busca clientes no SA1 por indice (ignora deletados e bloqueados)" ;
		PATH "/FinRestTitulos/clientesReceber" WSSYNTAX "/FinRestTitulos/clientesReceber"

	WSMETHOD POST PAGAR DESCRIPTION "Inclui titulo a pagar (FINA050 / SE2)" ;
		PATH "/FinRestTitulos/pagar" WSSYNTAX "/FinRestTitulos/pagar"

	WSMETHOD POST EXTORNARPAGAR DESCRIPTION "Estorna titulo a pagar sem movimentacao" ;
		PATH "/FinRestTitulos/pagar/extornar" WSSYNTAX "/FinRestTitulos/pagar/extornar"

	WSMETHOD POST CONSULTARPAGAR DESCRIPTION "Consulta titulo a pagar no SE2 (saldo, baixa, situacao)" ;
		PATH "/FinRestTitulos/pagar/consultar" WSSYNTAX "/FinRestTitulos/pagar/consultar"

	WSMETHOD POST FORNECEDORES DESCRIPTION "Busca fornecedores no SA2 por indice (ignora deletados e bloqueados)" ;
		PATH "/FinRestTitulos/pagar/fornecedores" WSSYNTAX "/FinRestTitulos/pagar/fornecedores"

	WSMETHOD POST TIPOS DESCRIPTION "Lista tipos de titulo SX5 tabela 05 (ignora deletados)" ;
		PATH "/FinRestTitulos/pagar/tipos" WSSYNTAX "/FinRestTitulos/pagar/tipos"

END WSRESTFUL

/*/{Protheus.doc} RECEBER
Inclui, estorna ou consulta titulo a receber na rota ja publicada /receber.
O job HTTP REST Cloud nao registra PATH novo depois da primeira publicacao da classe.
Use o campo acao no JSON: incluir (padrao), estornar, consultar, clientes.

Exemplo de payload:
{
  "acao":"estornar",
  "filial":"03",
  "filOrig":"0301",
  "prefixo":"EMP",
  "numero":"000333444",
  "parcela":"02",
  "tipo":"NP",
  "natureza":"1102011003",
  "cliente":"000001",
  "loja":"01",
  "emissao":"2026-08-15",
  "vencimento":"2026-09-15",
  "valor":100.50,
  "historico":"Titulo via API",
  "moeda":1,
  "centroCusto":""
}
/*/
WSMETHOD POST RECEBER WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object
	Local cAcao    := "" As Character

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)

	If !oTitulos:ParsePayload()
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
		FwFreeObj(oTitulos)
		Return lRet
	EndIf

	cAcao := Upper(oTitulos:JsonText("acao"))
	If cAcao == "ESTORNAR" .Or. cAcao == "EXTORNAR" .Or. cAcao == "EXCLUIR"
		oTitulos:ExcluirReceber()
	ElseIf cAcao == "CONSULTAR" .Or. cAcao == "SALDO"
		oTitulos:ConsultarReceber()
	ElseIf cAcao == "CLIENTES"
		oTitulos:ConsultarClientes()
	Else
		oTitulos:IncluirReceber()
	EndIf

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet

/*/{Protheus.doc} ESTORNAE1
Estorna titulo a receber sem movimentacao (baixa, bordero, saldo diferente).
Nao usa FINA040 exclusao. RecLock + DbDelete no SE1.

Exemplo de payload:
{
  "filial":"03",
  "filOrig":"0301",
  "prefixo":"EMP",
  "numero":"000333444",
  "parcela":"01",
  "tipo":"NP",
  "cliente":"000237",
  "loja":"01"
}
/*/
WSMETHOD POST ESTORNAE1 WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)
	oTitulos:ExcluirReceber()

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet

/*/{Protheus.doc} SALDOSE1
Consulta titulo a receber no SE1. Nao altera o titulo.

Exemplo de payload:
{
  "filial":"03",
  "filOrig":"0301",
  "prefixo":"EMP",
  "numero":"000333444",
  "parcela":"01",
  "tipo":"NP",
  "cliente":"000237",
  "loja":"01"
}
/*/
WSMETHOD POST SALDOSE1 WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)
	oTitulos:ConsultarReceber()

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet

/*/{Protheus.doc} CLIENTES
Busca clientes no SA1 por codigo, nome reduzido, razao ou CNPJ.
Nao lista deletados nem bloqueados (A1_MSBLQL). Sem troca de empresa.

Exemplo de payload:
{ "busca":"BRADESCO", "limit":40 }
/*/
WSMETHOD POST CLIENTES WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)
	oTitulos:ConsultarClientes()

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet

/*/{Protheus.doc} PAGAR
Inclui titulo a pagar via FINA050.

Exemplo de payload:
{
  "filial":"03",
  "filOrig":"0301",
  "prefixo":"EMP",
  "numero":"000333444",
  "parcela":"02",
  "tipo":"NP",
  "natureza":"1102011003",
  "fornecedor":"000048",
  "loja":"01",
  "emissao":"2026-08-15",
  "vencimento":"2026-09-15",
  "valor":250.00,
  "historico":"Titulo via API",
  "moeda":1,
  "centroCusto":""
}
/*/
WSMETHOD POST PAGAR WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)
	oTitulos:IncluirPagar()

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet

/*/{Protheus.doc} EXTORNARPAGAR
Estorna titulo a pagar sem movimentacao.
Valida se o titulo nao sofreu baixa/alteracao e grava D_E_L_E_T_ = '*' no SE2.

Exemplo de payload:
{
  "filial":"03",
  "filOrig":"0301",
  "prefixo":"EMP",
  "numero":"000333444",
  "parcela":"02",
  "tipo":"NP",
  "fornecedor":"000048",
  "loja":"01"
}
/*/
WSMETHOD POST EXTORNARPAGAR WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)
	oTitulos:ExcluirPagar()

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet

/*/{Protheus.doc} CONSULTARPAGAR
Consulta titulo a pagar no SE2. Nao altera o titulo.
HTTP 200 com encontrado=.F. quando a chave nao existe.

Exemplo de payload:
{
  "filial":"03",
  "filOrig":"0301",
  "prefixo":"EMP",
  "numero":"000333444",
  "parcela":"02",
  "tipo":"NP",
  "fornecedor":"000048",
  "loja":"01"
}
/*/
WSMETHOD POST CONSULTARPAGAR WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)
	oTitulos:ConsultarPagar()

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet

/*/{Protheus.doc} FORNECEDORES
Busca fornecedores no SA2 por codigo, nome reduzido, razao ou CNPJ.
Nao lista deletados nem bloqueados (A2_MSBLQL). Sem troca de empresa.

Exemplo de payload:
{ "busca":"JSTECNOLOGIA", "limit":40 }
/*/
WSMETHOD POST FORNECEDORES WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)
	oTitulos:ConsultarFornecedores()

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet

/*/{Protheus.doc} TIPOS
Lista tipos de titulo (SX5 tabela 05). Sem troca de empresa.

Exemplo de payload:
{ "busca":"NP", "limit":80 }
/*/
WSMETHOD POST TIPOS WSSERVICE FinRestTitulos

	Local lRet     := .F. As Logical
	Local oTitulos As Object

	Self:cPayload := ::GetContent()
	Self:SetContentType("application/json")
	oTitulos := FinRestTitulosSvc():New(Self:cPayload, @Self)
	oTitulos:ConsultarTipos()

	If oTitulos:Success()
		lRet := .T.
		Self:SetResponse(EncodeUtf8(oTitulos:GetReturn()))
	Else
		lRet := .F.
		Self:SetResponse(EncodeUtf8(oTitulos:GetError()))
		SetRestFault(400, EncodeUtf8(oTitulos:GetErrorMessage()))
	EndIf

	FwFreeObj(oTitulos)

Return lRet
