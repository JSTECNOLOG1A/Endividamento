#include "totvs.ch"
#include "Restful.ch"

/*/{Protheus.doc} PecCodeEstoque

    Classe com as regras e defini��es para baixa e estorno do estoque

    @author  Otaviano Mattos
    @since   18-10-2021
/*/
class PecCodeEstoque

	data cEmpresa        as character
	data cParamFil       as character
	data cPayload        as character
	data cDocumento      as character
	data cContaCtb       as character
	data cCodProduto     as character
	data cCentroCusto    as character
	data cClasseValor    as character
	data cArmazemPadrao  as character
	data cTipoMovimento  as character
	data cNumSequencia   as character
	data cError   as character
	data excecaocldebito   as character
	data excecaoclcredito   as character
	data aDados          as array
	data aDadosCabec     as array
	data aDadosItem      as array
	data oObjetoJson     as object
	data oPayloadObj     as object
	data nQuantidadeGado as numeric
	data nRecnoSequencia as integer
	data dEmissao        as date
	data cClasseValorDe  as character
	data cClasseValorAte as character
	data cContaDe        as character
	data cContaAte       as character
	data cCentroCustoDe  as character
	data cCentroCustoAte as character
	data cArqTmp         as character
	data dDataLucPerda   as date
	data dDataInicial    as date
	data dDataFinal      as date
	data nSaldoTotal     as numeric
	data nValor          as numeric
	data oApiRest		as Object
	data wrk     as Object
	data lSuccess       as Logical

	method new()
	method baixaEstoqueSaida()
	method estornoEstoqueBaixa()
	method entradaEstoqueBaixa()
	method buscaCustosFixos()
	method buscaArmazemPadrao()
	method validaInformacoesEnviadas()
	method validaEstornoEnviado()
	method validaDadosPayload()
	method balancoValidaDados()
	method quantidadeValida()
	method produtoExiste()
	method validaDataFechamentoEstoque()
	method validaEmpresaFilial()
	method normalizaEmpresa()
	method valorJson()
	method dataJson()
	method validaDocumentoEnviado()
	method montaDadosExecAuto()
	method cabecDadosExecAuto()
	method itensDadosExecAuto()
	method estornoDadosExecAuto()
	method devolveErroExecAuto()
	method buscaSequencialRecnoSD3()
	method criacaoSB2()
	method gravacaoComplementarSD3Saida()
	method estornoGravCompSD3()
	method converterPayloadParaJson()
	method enviaRespostaRequest()
	method buscaValorTotalBalancete()
	method buscaDadosBalancete()
	method buscaSaldoProduto()
	method Success()
	method GetReturn()
	method GetError()

endClass

/*/{Protheus.doc} new

    M�todo Construtor

    @author  Otaviano Mattos
    @param   cBody, payload enviado atrav�s da requisi��o
    @return  self, funcionalidades da classe
    @since   18-10-2021
/*/
method new(cBody, oApi) class PecCodeEstoque

	self:cPayload    := cBody
	self:aDados      := {}
	self:aDadosCabec := {}
	self:aDadosItem  := {}
	self:cArqTmp  := "cArqTmp"
	self:lSuccess := .T.
	self:oApiRest := oApi
	self:oPayloadObj := Nil

return Self

/*/{Protheus.doc} buscaSaldoProduto

    M�todo respons�vel por realizar a busca do saldo dos produtos.

    @author  Evandro Vendrametto
    @return  true, retorno padr�o do m�todo
    @since   18-07-2022
/*/
method buscaSaldoProduto() class PecCodeEstoque
	local aJson := {}
	local cAliasSB2 := GetNextAlias()
	local cArmazem := ""
	local nTamFil := 0
	local oItem as object

	self:wrk := JsonObject():new()

	// Usa ambiente da sessao REST (PrepareIn/OAuth). RpcSetEnv gera 500 no HTTPREST Cloud.
	self:cEmpresa := self:normalizaEmpresa(cValToChar(self:oApiRest:empresa))
	self:cCodProduto := AllTrim(cValToChar(self:oApiRest:produto))
	self:cArmazemPadrao := AllTrim(cValToChar(self:oApiRest:armazem))
	self:cParamFil := AllTrim(cValToChar(self:oApiRest:filial))

	if (Empty(self:cCodProduto) .or. Lower(self:cCodProduto) == "null")
		self:lSuccess := .F.
		self:cError := "Erro na consulta. Nao foi informado o produto."
		return
	endif

	if (Empty(self:cParamFil) .or. Lower(self:cParamFil) == "null")
		self:lSuccess := .F.
		self:cError := "Erro na consulta. Nao foi informada a filial."
		return
	endif

	If Empty(self:cEmpresa) .or. !FWFilExist(self:cEmpresa, self:cParamFil)
		self:lSuccess := .F.
		self:cError := "Erro na consulta. Nao foi informada a filial."
		return
	EndIf

	If Lower(self:cArmazemPadrao) == "null"
		self:cArmazemPadrao := ""
	EndIf

	nTamFil := TamSX3("B2_FILIAL")[1]
	If Len(self:cParamFil) < nTamFil
		self:cParamFil := PadR(self:cParamFil, nTamFil)
	EndIf

	self:cCodProduto := PadR(self:cCodProduto, TamSX3("B2_COD")[1])

	If !Empty(self:cArmazemPadrao)
		cArmazem := PadR(self:cArmazemPadrao, TamSX3("B2_LOCAL")[1])
	EndIf

	If Empty(cArmazem)
		BEGINSQL Alias cAliasSB2
			SELECT B2_FILIAL, B2_QATU, B2_LOCAL, B2_SALPEDI, B2_VATU1, B2_COD, B2_RESERVA
			FROM %TABLE:SB2% SB2
			WHERE B2_FILIAL = %EXP:self:cParamFil%
				AND B2_COD = %EXP:self:cCodProduto%
				AND SB2.%NOTDEL%
		ENDSQL
	Else
		BEGINSQL Alias cAliasSB2
			SELECT B2_FILIAL, B2_QATU, B2_LOCAL, B2_SALPEDI, B2_VATU1, B2_COD, B2_RESERVA
			FROM %TABLE:SB2% SB2
			WHERE B2_FILIAL = %EXP:self:cParamFil%
				AND B2_COD = %EXP:self:cCodProduto%
				AND B2_LOCAL = %EXP:cArmazem%
				AND SB2.%NOTDEL%
		ENDSQL
	EndIf

	while (cAliasSB2)->(!EOF())
		oItem := JsonObject():New()
		oItem["B2_FILIAL"] := AllTrim((cAliasSB2)->(B2_FILIAL))
		oItem["B2_QATU"] := (cAliasSB2)->(B2_QATU)
		oItem["B2_LOCAL"] := AllTrim((cAliasSB2)->(B2_LOCAL))
		oItem["B2_SALPEDI"] := (cAliasSB2)->(B2_SALPEDI)
		oItem["B2_VATU1"] := (cAliasSB2)->(B2_VATU1)
		oItem["B2_COD"] := AllTrim((cAliasSB2)->(B2_COD))
		oItem["B2_RESERVA"] := (cAliasSB2)->(B2_RESERVA)
		aAdd(aJson, oItem)
		(cAliasSB2)->(dbSkip())
	end
	(cAliasSB2)->(dbCloseArea())

	self:lSuccess := .T.
	self:wrk:set(aJson)

return

Method Success() Class PecCodeEstoque
Return self:lSuccess

Method GetReturn() Class PecCodeEstoque
    
Return self:wrk:toJSON()

Method GetError() Class PecCodeEstoque
	Local cError := self:cError
Return cError

/*/{Protheus.doc} entradaEstoqueBaixa

    M�todo respons�vel por realizar a entrada no estoque.

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  true, retorno padr�o do m�todo
    @since   06-11-2021
/*/
method entradaEstoqueBaixa() class PecCodeEstoque

	local aAreas            as array
	local aLogAuto          as array
	local lValidaTMEntrada := .F.
	local nInclusao        := 3
	private lMsErroAuto    := .F.
	private lAutoErrNoFile := .T.

	If !self:converterPayloadParaJson()
		self:enviaRespostaRequest(self:cError)
		return .F.
	EndIf

	If(!self:validaDadosPayload())
		return .F.
	EndIf

	self:cEmpresa  := self:normalizaEmpresa(self:valorJson("empresa"))
	self:cParamFil := self:valorJson("filial")

	If Empty(self:cEmpresa) .or. !FWFilExist(self:cEmpresa, self:cParamFil)
		self:enviaRespostaRequest("A empresa/filial enviada nao existe.")
		return .F.
	EndIf

	// Ambiente REST (PrepareIn/OAuth). RpcSetEnv gera 500 no HTTPREST Cloud.
	If Len(AllTrim(self:cParamFil)) < TamSX3("B2_FILIAL")[1]
		self:cParamFil := PadR(self:cParamFil, TamSX3("B2_FILIAL")[1])
	EndIf
	cEmpAnt := self:cEmpresa
	cFilAnt := self:cParamFil

	self:cDocumento      := PadR(self:valorJson("documento"), TAMSX3("D3_DOC")[1])
	self:cCodProduto     := PadR(self:valorJson("produto"), TAMSX3("D3_COD")[1])
	self:cTipoMovimento  := self:valorJson("tipoMovimento")
	self:cContaCtb       := self:valorJson("conta")
	self:cCentroCusto    := self:valorJson("centrocusto")
	self:cClasseValor    := self:valorJson("classevalor")
	self:cArmazemPadrao  := self:valorJson("armazem")
	self:nQuantidadeGado := Val(self:valorJson("quantidade"))
	self:nValor          := Val(self:valorJson("valor"))
	self:dEmissao        := self:dataJson("emissao")

	If !Empty(self:cContaCtb)
		self:cContaCtb := PadR(self:cContaCtb, TAMSX3("D3_CONTA")[1])
	EndIf
	If !Empty(self:cCentroCusto)
		self:cCentroCusto := PadR(self:cCentroCusto, TAMSX3("D3_CC")[1])
	EndIf
	If !Empty(self:cClasseValor)
		self:cClasseValor := PadR(self:cClasseValor, TAMSX3("D3_CLVL")[1])
	EndIf
	If !Empty(self:cArmazemPadrao)
		self:cArmazemPadrao := PadR(self:cArmazemPadrao, TAMSX3("D3_LOCAL")[1])
	EndIf

	If self:cTipoMovimento <= "500"
		lValidaTMEntrada := .T.
	Else
		lValidaTMEntrada := .F.
	EndIf
	aAreas           := {SB1->(GetArea()),SB2->(GetArea())}

	If(Empty(self:cArmazemPadrao))
		self:cArmazemPadrao := self:buscaArmazemPadrao()
	EndIf

	If(!lValidaTMEntrada)
		self:enviaRespostaRequest("A TM enviada nao e de entrada.")
		aEval(aAreas,{|x| RestArea(x) })
		return .F.
	EndIf

	If(!self:validaInformacoesEnviadas())
		aEval(aAreas,{|x| RestArea(x) })
		return .F.
	EndIf

	Self:criacaoSB2()

	self:aDadosCabec := self:cabecDadosExecAuto()
	self:aDadosItem  := self:itensDadosExecAuto()

	Begin Transaction
		MSExecAuto({ |x, y, z| Mata241(x, y, z) }, self:aDadosCabec, self:aDadosItem, nInclusao)
		If lMsErroAuto
			DisarmTransaction()
		EndIf
	End Transaction

	If(lMsErroAuto)

		aEval(aAreas,{|x| RestArea(x) })
		aLogAuto := GetAutoGRLog()
		self:devolveErroExecAuto(aLogAuto)
		return .F.

	EndIf

	self:oApiRest:SetResponse(EncodeUtf8('{"code":200,"response":"Entrada feita com sucesso."}'))

	aEval(aAreas,{|x| RestArea(x) })

return .T.

/*/{Protheus.doc} baixaEstoqueSaida

    M�todo respons�vel por realizar a baixa de sa�da do estoque.

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  true, retorno padr�o do m�todo
    @since   18-10-2021
/*/
method baixaEstoqueSaida() class PecCodeEstoque

	Local aAreas           as array
	Local aLogAuto          as array
	Local lValidaTMSaida   := .F.
	Local nInclusao        := 3
	Private lMsErroAuto    := .F.
	Private lAutoErrNoFile := .T.
	If !self:converterPayloadParaJson()
		self:enviaRespostaRequest(self:cError)
		return .F.
	EndIf

	If(!self:validaDadosPayload())
		return .F.
	EndIf

	self:cParamFil := self:valorJson("filial")
	self:cEmpresa  := self:normalizaEmpresa(self:valorJson("empresa"))

	If Empty(self:cEmpresa) .or. !FWFilExist(self:cEmpresa, self:cParamFil)
		self:enviaRespostaRequest("A empresa/filial enviada nao existe.")
		return .F.
	EndIf

	// Ambiente REST (PrepareIn/OAuth). RpcSetEnv gera 500 no HTTPREST Cloud.
	If Len(AllTrim(self:cParamFil)) < TamSX3("B2_FILIAL")[1]
		self:cParamFil := PadR(self:cParamFil, TamSX3("B2_FILIAL")[1])
	EndIf
	cEmpAnt := self:cEmpresa
	cFilAnt := self:cParamFil

	self:cDocumento      := PadR(self:valorJson("documento"), TAMSX3("D3_DOC")[1])
	self:cCodProduto     := PadR(self:valorJson("produto"), TAMSX3("D3_COD")[1])
	self:cTipoMovimento  := self:valorJson("tipoMovimento")
	self:cCentroCusto    := self:valorJson("centrocusto")
	self:cClasseValor    := self:valorJson("classevalor")
	self:cArmazemPadrao  := self:valorJson("armazem")
	self:nQuantidadeGado := Val(self:valorJson("quantidade"))
	self:dEmissao        := self:dataJson("emissao")
	self:nValor          := Val(self:valorJson("valor"))

	If !Empty(self:cCentroCusto)
		self:cCentroCusto := PadR(self:cCentroCusto, TAMSX3("D3_CC")[1])
	EndIf
	If !Empty(self:cClasseValor)
		self:cClasseValor := PadR(self:cClasseValor, TAMSX3("D3_CLVL")[1])
	EndIf
	If !Empty(self:cArmazemPadrao)
		self:cArmazemPadrao := PadR(self:cArmazemPadrao, TAMSX3("D3_LOCAL")[1])
	EndIf

	If self:cTipoMovimento >= "501"
		lValidaTMSaida := .T.
	Else
		lValidaTMSaida := .F.
	EndIf
	aAreas         := {SB1->(GetArea()),SB2->(GetArea())}

	If(Empty(self:cArmazemPadrao))
		self:cArmazemPadrao := self:buscaArmazemPadrao()
	EndIf

	If(!lValidaTMSaida)
		self:enviaRespostaRequest("A TM enviada nao e de saida.")
		aEval(aAreas,{|x| RestArea(x) })
		return .F.
	EndIf

	If(!self:validaInformacoesEnviadas())
		aEval(aAreas,{|x| RestArea(x) })
		return .F.
	EndIf

	Self:criacaoSB2()

	self:aDados := self:montaDadosExecAuto()

	Begin Transaction
		MSExecAuto({|x, y| MATA240(x, y)}, self:aDados, nInclusao)
		If lMsErroAuto
			DisarmTransaction()
		Else
			self:gravacaoComplementarSD3Saida()
		EndIf
	End Transaction

	If(lMsErroAuto)
		aEval(aAreas,{|x| RestArea(x) })
		aLogAuto := GetAutoGRLog()
		self:devolveErroExecAuto(aLogAuto)
		return .F.

	EndIf

	self:oApiRest:SetResponse(EncodeUtf8('{"code":200,"valorBaixado":' + AllTrim(cValToChar(SD3->D3_CUSTO1)) + ',"response":"Saida feita com sucesso."}'))

	aEval(aAreas,{|x| RestArea(x) })

return .T.

/*/{Protheus.doc} estornoEstoqueBaixa

    M�todo respons�vel por realizar o estorno da movimenta��o do estoque

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  true, retorno padr�o do m�todo
    @since   18-10-2021
/*/
method estornoEstoqueBaixa() class PecCodeEstoque

	Local aAreas           as array
	Local aLogAuto          as array
	Local nEstorno         := 5
	Private lMsErroAuto    := .F.
	Private lAutoErrNoFile := .T.

	If !self:converterPayloadParaJson()
		self:enviaRespostaRequest(self:cError)
		return .F.
	EndIf

	If(!self:validaDadosPayload())
		return .F.
	EndIf

	self:cEmpresa  := self:normalizaEmpresa(self:valorJson("empresa"))
	self:cParamFil := self:valorJson("filial")

	If Empty(self:cEmpresa) .or. !FWFilExist(self:cEmpresa, self:cParamFil)
		self:enviaRespostaRequest("A empresa/filial enviada nao existe.")
		return .F.
	EndIf

	// Ambiente REST (PrepareIn/OAuth). RpcSetEnv gera 500 no HTTPREST Cloud.
	If Len(AllTrim(self:cParamFil)) < TamSX3("B2_FILIAL")[1]
		self:cParamFil := PadR(self:cParamFil, TamSX3("B2_FILIAL")[1])
	EndIf
	cEmpAnt := self:cEmpresa
	cFilAnt := self:cParamFil

	self:cDocumento      := PadR(self:valorJson("documento"), TAMSX3("D3_DOC")[1])
	self:cCodProduto     := PadR(self:valorJson("produto"), TAMSX3("D3_COD")[1])
	self:cTipoMovimento  := self:valorJson("tipoMovimento")
	self:cCentroCusto    := self:valorJson("centrocusto")
	self:cClasseValor    := self:valorJson("classevalor")
	self:cArmazemPadrao  := self:valorJson("armazem")
	self:nQuantidadeGado := Val(self:valorJson("quantidade"))
	self:dEmissao        := self:dataJson("emissao")
	self:nValor          := Val(self:valorJson("valor"))

	If !Empty(self:cCentroCusto)
		self:cCentroCusto := PadR(self:cCentroCusto, TAMSX3("D3_CC")[1])
	EndIf
	If !Empty(self:cClasseValor)
		self:cClasseValor := PadR(self:cClasseValor, TAMSX3("D3_CLVL")[1])
	EndIf
	If !Empty(self:cArmazemPadrao)
		self:cArmazemPadrao := PadR(self:cArmazemPadrao, TAMSX3("D3_LOCAL")[1])
	EndIf

	aAreas := {SB1->(GetArea()),SB2->(GetArea())}

	If(!self:validaDocumentoEnviado())

		self:enviaRespostaRequest("O documento e o produto enviados para estorno nao existem.")
		aEval(aAreas,{|x| RestArea(x) })
		return .F.

	EndIf

	if (!self:validaEstornoEnviado())
		self:enviaRespostaRequest("O documento ja foi estornado.")
		aEval(aAreas,{|x| RestArea(x) })
		return .F.
	endif

	If(Empty(self:cArmazemPadrao))
		self:cArmazemPadrao := SD3->D3_LOCAL
	EndIf

	If(!self:validaInformacoesEnviadas())
		aEval(aAreas,{|x| RestArea(x) })
		return .F.
	EndIf

	Self:criacaoSB2()

	self:buscaSequencialRecnoSD3()
	self:aDados := self:estornoDadosExecAuto()

	Begin Transaction
		MSExecAuto({|x, y| MATA240(x, y)}, self:aDados, nEstorno)
		If lMsErroAuto
			DisarmTransaction()
		Else
			self:estornoGravCompSD3()
		EndIf
	End Transaction

	If lMsErroAuto

		aEval(aAreas,{|x| RestArea(x) })
		aLogAuto := GetAutoGRLog()
		self:devolveErroExecAuto(aLogAuto)
		return .F.

	EndIf
	self:oApiRest:SetResponse(EncodeUtf8('{"code":200,"response":"Estorno feito com sucesso."}'))

	aEval(aAreas,{|x| RestArea(x) })

return .T.

/*/{Protheus.doc} validaDadosPayload

    M�todo respons�vel por validar o payload enviado na requisi��o

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  lRetorno, retorna se o payload � v�lido para prosseguir
    @since   18-10-2021
/*/
method validaDadosPayload() class PecCodeEstoque

	local lRetorno         as logical
	local cProduto         as character
	local cTipoMovimento   as character
	local cPayload         as character
	local cQuantidadeGado  as character
	local cParamFil          as character
	local cDocumento       as character
	local dEmissao         as date

	lRetorno         := .T.
	cPayload         := self:cPayload
	cParamFil        := self:valorJson("filial")
	cDocumento       := self:valorJson("documento")
	cProduto         := self:valorJson("produto")
	cTipoMovimento   := self:valorJson("tipoMovimento")
	cQuantidadeGado  := self:valorJson("quantidade")
	dEmissao         := self:dataJson("emissao")

	DO CASE

	CASE Empty(cPayload)
		self:enviaRespostaRequest("Envie o body antes de continuar.")
		lRetorno := .F.

	CASE Empty(cDocumento)
		self:enviaRespostaRequest("Envie o documento antes de continuar. Payload=[" + Left(AllTrim(cPayload), 80) + "]")
		lRetorno := .F.

	CASE Empty(cProduto)
		self:enviaRespostaRequest("Envie o codigo do produto antes de continuar.")
		lRetorno := .F.

	CASE Empty(cTipoMovimento)
		self:enviaRespostaRequest("Envie o tipo de movimento antes de continuar.")
		lRetorno := .F.

	CASE Empty(cQuantidadeGado)
		self:enviaRespostaRequest("Envie a quantidade antes de continuar.")
		lRetorno := .F.

	CASE Empty(dEmissao)
		self:enviaRespostaRequest("Envie a emissao antes de continuar.")
		lRetorno := .F.

	CASE Empty(cParamFil)
		self:enviaRespostaRequest("Envie a filial antes de continuar.")
		lRetorno := .F.

	ENDCASE

return lRetorno

/*/{Protheus.doc} normalizaEmpresa

    Retorna a empresa enviada na request ou, quando omitida, a empresa
    posicionada no ambiente atual do Protheus.

    @param   cEmpresa, c�digo opcional da empresa
    @return  character, c�digo da empresa a ser utilizado
    @since   07-08-2026
/*/
method normalizaEmpresa(cEmpresa) class PecCodeEstoque

	default cEmpresa := ""
	cEmpresa := AllTrim(cEmpresa)

	If Empty(cEmpresa) .or. Lower(cEmpresa) == "null"
		cEmpresa := FWCodEmp()
	EndIf

return cEmpresa

/*/{Protheus.doc} valorJson

    Retorna uma propriedade JSON normalizada. Campos ausentes e valores null
    sao tratados como vazio para que nao sejam enviados ao MSExecAuto.

    @param   cCampo, nome da propriedade JSON
    @return  character, valor normalizado
    @since   10-08-2026
/*/
method valorJson(cCampo) class PecCodeEstoque

	Local cValor := ""

	Default cCampo := ""

	If ValType(self:oObjetoJson) != "O"
		Return ""
	EndIf

	cValor := AllTrim(cValToChar(self:oObjetoJson:GetJsonText(cCampo)))

	If Len(cValor) >= 2 .And. Left(cValor, 1) == '"' .And. Right(cValor, 1) == '"'
		cValor := AllTrim(SubStr(cValor, 2, Len(cValor) - 2))
	EndIf

	If Empty(cValor) .Or. Upper(cValor) == "NULL"
		cValor := ""
	EndIf

return cValor

/*/{Protheus.doc} dataJson

    Converte datas JSON nos formatos DD/MM/AAAA, AAAAMMDD ou AAAA-MM-DD.

    @param   cCampo, nome da propriedade JSON
    @return  date, data convertida ou data vazia
    @since   10-08-2026
/*/
method dataJson(cCampo) class PecCodeEstoque

	Local cData := self:valorJson(cCampo)
	Local cDataIso := ""

	If Empty(cData)
		return CtoD("")
	EndIf

	If Len(cData) == 8 .and. At("/", cData) == 0 .and. At("-", cData) == 0
		return StoD(cData)
	EndIf

	If Len(cData) == 10 .and. SubStr(cData, 5, 1) == "-" .and. SubStr(cData, 8, 1) == "-"
		cDataIso := StrTran(cData, "-", "")
		return StoD(cDataIso)
	EndIf

return CtoD(cData)

/*/{Protheus.doc} buscaArmazemPadrao

    M�todo respons�vel por buscar o armazem vinculado no produto

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  Posicione, retorna o armaz�m do produto enviado
    @since   18-10-2021
/*/
method buscaArmazemPadrao() class PecCodeEstoque

	local cProduto as character

	cProduto := self:cCodProduto

return Posicione("SB1", 1, xFilial("SB1") + cProduto, "B1_LOCPAD")

/*/{Protheus.doc} validaInformacoesEnviadas

    M�todo respons�vel por validar as regras de cada propriedade enviada na request

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  lRetorno, retorna se as informa��es enviadas respeitam a regra necess�rio para prosseguir
    @since   18-10-2021
/*/
method validaInformacoesEnviadas() as logical class PecCodeEstoque

	local lRetorno as logical

	lRetorno := .T.

	DO CASE

	CASE !self:produtoExiste()

		self:enviaRespostaRequest("O produto enviado nao existe.")
		lRetorno := .F.

	CASE Empty(self:cArmazemPadrao)

		self:enviaRespostaRequest("Informe o armazem ou cadastre o armazem padrao do produto.")
		lRetorno := .F.

	CASE !self:quantidadeValida()

		self:enviaRespostaRequest("A quantidade enviada deve ser maior do que zero.")
		lRetorno := .F.

	CASE !self:validaDataFechamentoEstoque()

		self:enviaRespostaRequest("A data enviada nao e permitida, pois o estoque ja esta fechado.")
		lRetorno := .F.

	CASE !self:validaEmpresaFilial()

		self:enviaRespostaRequest("A empresa/filial enviada nao existe.")
		lRetorno := .F.

	ENDCASE

return lRetorno

/*/{Protheus.doc} validaEmpresaFilial

    M�todo respons�vel por validar se a empresa e filial enviadas existem no cadastro do Protheus

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  logical, validar se a empresa e filial enviadas existem no cadastro do Protheus
    @since   18-10-2021
/*/
method validaEmpresaFilial() class PecCodeEstoque

	local cEmpresa as character
	local cParamFil  as character

	cEmpresa := self:cEmpresa
	cParamFil  := self:cParamFil

return FWFilExist(cEmpresa, cParamFil)

/*/{Protheus.doc} validaDataFechamentoEstoque

    M�todo respons�vel por validar se a data enviada � menor do que a data de fechamento do estoque

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  logical, retorna se a data enviada no payload � maior do que a data do fechamento do estoque
    @since   18-10-2021
/*/
method validaDataFechamentoEstoque() class PecCodeEstoque

	local dDataFechamentoEstoque as date
	local dDataEnvioPayload      as date

	dDataFechamentoEstoque := GetNewPar("MV_ULMES")
	dDataEnvioPayload      := self:dEmissao

return dDataEnvioPayload > dDataFechamentoEstoque

/*/{Protheus.doc} quantidadeValida

    M�todo respons�vel por validar se a quantidade enviada � maior do que 0

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  logical, retorna se a quantidade enviada � maior do que 0
    @since   18-10-2021
/*/
method quantidadeValida() class PecCodeEstoque

	local nQuantidadeGado as numeric
	local result as logical
	local cResulTpMov as character
	static cCodTM as character
	static cCodEntEst := "499"
	static cCodSaiEst := "999"

	result := .F.
	nQuantidadeGado := self:nQuantidadeGado
	cCodTM := PadR(self:cTipoMovimento, TamSx3("F5_CODIGO")[1])
	cResulTpMov := Posicione("SF5", 1, xFilial("SF5") + cCodTM, "F5_QTDZERO")
	if (cResulTpMov == "1")
		result := .T.
	elseif (cResulTpMov == "2")
		if (nQuantidadeGado > 0)
			result := .T.
		endif
	elseif (self:cTipoMovimento == cCodEntEst .or. self:cTipoMovimento == cCodSaiEst)
		result := .T.
	endif

return result

/*/{Protheus.doc} produtoExiste

    M�todo respons�vel por validar se o produto existe

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  logical, retorna se o produto enviado no payload existe cadastrado no sistema
    @since   18-10-2021
/*/
method produtoExiste() class PecCodeEstoque

	local cProduto as character

	cProduto := self:cCodProduto

	DbSelectArea("SB1")
	SB1->(DbSetOrder(1))
	If(!SB1->(DbSeek(xFilial("SB1") + cProduto)))
		Return(.F.)
	EndIf

return .T.

/*/{Protheus.doc} criacaoSB2

    M�todo respons�vel por criar a movimenta��o do produto enviado na SB2

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  true, realiza a cria��o do produto na SB2
    @since   18-10-2021
/*/
method criacaoSB2() class PecCodeEstoque

	local cProduto        as character
	local cArmazemProduto as character

	cProduto        := self:cCodProduto
	cArmazemProduto := self:cArmazemPadrao

	DbSelectArea("SB2")
	SB2->(DbSetOrder(1))
	If !SB2->(DbSeek(xFilial("SB2") + cProduto + cArmazemProduto))
		CriaSB2(cProduto, cArmazemProduto)
		// A fun��o acima n�o libera o registro
		SB2->(MsUnlock())
	EndIf

return

/*/{Protheus.doc} cabecDadosExecAuto

    M�todo respons�vel por montar o cabe�alho do array do execauto

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  aRetorno, retorna o array com as informa��es para execu��o do execauto
    @since   06-11-2021
/*/
method cabecDadosExecAuto() as array class PecCodeEstoque

	local aRetorno   as array

	aRetorno := {}

	aAdd(aRetorno, {"D3_DOC"     , self:cDocumento    , Nil})
	aAdd(aRetorno, {"D3_TM"      , self:cTipoMovimento, Nil})
	aAdd(aRetorno, {"D3_EMISSAO" , self:dEmissao      , Nil})

	If !Empty(self:cCentroCusto)
		aAdd(aRetorno, {"D3_CC", self:cCentroCusto, Nil})
	EndIf

return aRetorno

/*/{Protheus.doc} itensDadosExecAuto

    M�todo respons�vel por montar o item do array do execauto

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  aRetorno, retorna o array com as informa��es para execu��o do execauto
    @since   06-11-2021
/*/
method itensDadosExecAuto() as array class PecCodeEstoque

	local aRetorno     as array
	local nCusto       as numeric
	static cCodTM      as character
	static lValorizado as logical

	aRetorno    := {}
	nCusto      := 0
	cCodTM      := PadR(self:cTipoMovimento, TamSx3("F5_CODIGO")[1])
	lValorizado := AllTrim(Posicione("SF5", 1, xFilial("SF5") + cCodTM, "F5_VAL")) == "S"

	aAdd(aRetorno, {"D3_COD"  , self:cCodProduto       ,Nil})
	aAdd(aRetorno, {"D3_LOCAL", self:cArmazemPadrao    ,Nil})
	aAdd(aRetorno, {"D3_UM"   , SB1->B1_UM             ,Nil})
	aAdd(aRetorno, {"D3_QUANT", self:nQuantidadeGado   ,Nil})
	aAdd(aRetorno, {"D3_OBS"  , 'Inclus�o via Pec Code',Nil})

	If !Empty(self:cClasseValor)
		aAdd(aRetorno, {"D3_CLVL", self:cClasseValor, Nil})
	EndIf

	if(!Empty(self:cContaCtb))
		aAdd(aRetorno, {"D3_CONTA", self:cContaCtb, Nil})
	endif

	If(lValorizado)
		if (self:nValor > 0)
			aAdd(aRetorno, {"D3_CUSTO1", self:nValor, Nil})
		else
			nCusto := Posicione('SB2', 1, xFilial('SB2') + SB1->B1_COD + self:cArmazemPadrao, 'B2_CM1')
			If nCusto > 0
				aAdd(aRetorno, {"D3_CUSTO1", nCusto, Nil})
			EndIf
		endif
	Endif

return {aRetorno}

/*/{Protheus.doc} montaDadosExecAuto

    M�todo respons�vel por montar o array do execauto

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  aRetorno, retorna o array com as informa��es para execu��o do execauto
    @since   18-10-2021
/*/
method montaDadosExecAuto() as array class PecCodeEstoque

	local aRetorno := {}

	// Vetor minimo recomendado pela MATA240. Campos opcionais vazios nao
	// devem ser enviados, pois passam pela validacao do dicionario/SX3.
	aAdd(aRetorno, {"D3_TM"     , self:cTipoMovimento , Nil})
	aAdd(aRetorno, {"D3_COD"    , self:cCodProduto    , Nil})
	aAdd(aRetorno, {"D3_UM"     , SB1->B1_UM          , Nil})
	aAdd(aRetorno, {"D3_QUANT"  , self:nQuantidadeGado, Nil})
	aAdd(aRetorno, {"D3_LOCAL"  , self:cArmazemPadrao , Nil})
	aAdd(aRetorno, {"D3_EMISSAO", self:dEmissao       , Nil})
	aAdd(aRetorno, {"D3_DOC"    , self:cDocumento     , Nil})

	If !Empty(self:cCentroCusto)
		aAdd(aRetorno, {"D3_CC", self:cCentroCusto, Nil})
	EndIf
	If !Empty(self:cClasseValor)
		aAdd(aRetorno, {"D3_CLVL", self:cClasseValor, Nil})
	EndIf
	If self:nValor > 0
		aAdd(aRetorno, {"D3_CUSTO1", self:nValor, Nil})
	EndIf

return aRetorno

/*/{Protheus.doc} estornoDadosExecAuto

    M�todo respons�vel por montar o array do execauto de estorno

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  aRetorno, retorna o array com as informa��es para execu��o do execauto de estorno
    @since   18-10-2021
/*/
method estornoDadosExecAuto() as array class PecCodeEstoque

	local aRetorno := {}

	aAdd(aRetorno, {"D3_TM"     , self:cTipoMovimento , Nil})
	aAdd(aRetorno, {"D3_COD"    , self:cCodProduto    , Nil})
	aAdd(aRetorno, {"D3_UM"     , SB1->B1_UM          , Nil})
	aAdd(aRetorno, {"D3_QUANT"  , self:nQuantidadeGado, Nil})
	aAdd(aRetorno, {"D3_LOCAL"  , self:cArmazemPadrao , Nil})
	aAdd(aRetorno, {"D3_EMISSAO", self:dEmissao       , Nil})
	aAdd(aRetorno, {"D3_DOC"    , self:cDocumento     , Nil})
	aAdd(aRetorno, {"D3_NUMSEQ" , self:cNumSequencia  , Nil})
	aAdd(aRetorno, {"INDEX"     , 2                   , Nil})

	If !Empty(self:cCentroCusto)
		aAdd(aRetorno, {"D3_CC", self:cCentroCusto, Nil})
	EndIf
	If !Empty(self:cClasseValor)
		aAdd(aRetorno, {"D3_CLVL", self:cClasseValor, Nil})
	EndIf
	If self:nValor > 0
		aAdd(aRetorno, {"D3_CUSTO1", self:nValor, Nil})
	EndIf

return aRetorno

/*/{Protheus.doc} gravacaoComplementarSD3Saida

    M�todo respons�vel por realizar grava��es complementares na SD3

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  lRetorno, retorna se o payload � v�lido para prosseguir
    @since   18-10-2021
/*/
method gravacaoComplementarSD3Saida() class PecCodeEstoque

	local cCodTM := PadR(self:cTipoMovimento, TamSx3("F5_CODIGO")[1])
	local lValorizado := .F.
	static cTipoRequisicao as character
	static cChaveIndexacao as character

	cTipoRequisicao := "RE1"
	cChaveIndexacao := "E1"

	lValorizado := AllTrim(Posicione("SF5", 1, xFilial("SF5") + cCodTM, "F5_VAL")) == "S"
	if (lValorizado)
		cTipoRequisicao := "RE6"
		cChaveIndexacao := "E0"
	endif

	If RecLock("SD3", .F.)
		SD3->D3_CF    := cTipoRequisicao
		SD3->D3_CHAVE := cChaveIndexacao
		SD3->(MsUnlock())
	Endif

return

/*/{Protheus.doc} converterPayloadParaJson

    M�todo respons�vel por converter o payload enviado em JSONProperty

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  true, realiza a convers�o do payload para JSON Property
    @since   18-10-2021
/*/
method converterPayloadParaJson() class PecCodeEstoque

	Local cErrJson := ""
	Local cBody := ""

	cBody := AllTrim(cValToChar(self:cPayload))
	If Empty(cBody)
		self:cError := "Envie um JSON no corpo da requisicao."
		return .F.
	EndIf

	self:cPayload := cBody
	self:oObjetoJson := JsonObject():New()
	cErrJson := self:oObjetoJson:FromJson(self:cPayload)

	If ValType(cErrJson) == "C" .And. !Empty(cErrJson)
		self:cError := "JSON invalido: " + cErrJson
		return .F.
	EndIf

	// Se FromJson devolveu o objeto populado
	If ValType(cErrJson) == "O"
		self:oObjetoJson := cErrJson
	EndIf

return .T.

/*/{Protheus.doc} devolveErroExecAuto

    M�todo respons�vel por devolver o erro gerado no execauto

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  logical, devolve para a request o erro apresentado no execauto
    @since   18-10-2021
/*/
method devolveErroExecAuto(aLogAuto) class PecCodeEstoque

	Local cLogTxt := ''
	Local aArray := {}
	Local nY := 0
	Local nX := 0
	For nY := 1 To Len(aLogAuto)
		If !Empty(cLogTxt)
			cLogTxt += "#"
		EndIf
		If !Empty(aLogAuto[nY])
			aArray := StrToKarr(Alltrim(aLogAuto[nY]) , CRLF)
			For nX := 1 To Len(aArray)
				If !Empty(aArray[nX])
					cLogTxt += Alltrim(aArray[nX])
				EndIf
			Next
		EndIf
	Next
	self:enviaRespostaRequest(Alltrim(cLogTxt))

return

/*/{Protheus.doc} validaDocumentoEnviado

    M�todo respons�vel por validar se o documento enviado para estorno existe

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  logical, validar se o documento enviado para estorno existe
    @since   21-10-2021
/*/
method validaDocumentoEnviado() as logical class PecCodeEstoque

	local cDocumento as character
	local cProduto   as character
	local lRetorno   as logical

	lRetorno   := .F.
	cDocumento := self:cDocumento
	cProduto   := self:cCodProduto

	DbSelectArea("SD3")
	SD3->(DbSetOrder(2))
	If SD3->(DbSeek(xFilial("SD3")+ cDocumento + cProduto))
		lRetorno := .T.
	Endif

return lRetorno

/*/{Protheus.doc} validaEstornoEnviado
	validar se o documento j� foi estornado
	@author Evandro Vendrametto
	@since 25/02/2022
/*/
method validaEstornoEnviado() as logical class PecCodeEstoque

	local cDocumento as character
	local cProduto   as character
	local lRetorno   as logical

	lRetorno   := .F.
	cDocumento := self:cDocumento
	cProduto   := self:cCodProduto

	DbSelectArea("SD3")
	SD3->(DbSetOrder(2))
	If SD3->(DbSeek(xFilial("SD3")+ cDocumento + cProduto))
		if (SD3->D3_ESTORNO == "S")
			lRetorno := .F.
		else
			lRetorno := .T.
		endif
	Endif

return lRetorno

/*/{Protheus.doc} buscaSequencialRecnoSD3

    M�todo respons�vel por buscar o sequencial e o recno do documento para estorno

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  logical, buscar o sequencial e o recno do documento para estorno
    @since   18-10-2021
/*/
method buscaSequencialRecnoSD3() class PecCodeEstoque

	local cDocumento as character
	local cProduto   as character

	cDocumento := self:cDocumento
	cProduto   := self:cCodProduto

	DbSelectArea("SD3")
	SD3->(DbSetOrder(2))
	If SD3->(DbSeek(xFilial("SD3")+ cDocumento + cProduto))
		self:nRecnoSequencia := SD3->(Recno())
		self:cNumSequencia   := Posicione("SD3",2,xFilial("SD3") + cDocumento + cProduto,"D3_NUMSEQ")
	Endif

return

/*/{Protheus.doc} estornoGravCompSD3

    M�todo respons�vel por realizar grava��es complementares na SD3 ap�s o estorno

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  logical, realizar grava��es complementares na SD3 ap�s o estorno
    @since   18-10-2021
/*/
method estornoGravCompSD3() class PecCodeEstoque

	local cCodTM           := PadR(self:cTipoMovimento, TamSx3("F5_CODIGO")[1])
	local cEstorno         := "S"
	local nRecSeq          as numeric
	local cNumSeq          as character
	local lValorizado      := .F.
	static cTipoDevolucao  as character
	static cChaveIndexacao as character

	nRecSeq := self:nRecnoSequencia
	cNumSeq := self:cNumSequencia
	cTipoDevolucao  := "DE1"
	cChaveIndexacao := "E1"
	lValorizado := AllTrim(Posicione("SF5", 1, xFilial("SF5") + cCodTM, "F5_VAL")) == "S"

	If RecLock("SD3", .F.)
		if (!lValorizado)
			SD3->D3_CF      := cTipoDevolucao
			SD3->D3_CHAVE   := cChaveIndexacao
		endif
		SD3->D3_ESTORNO := cEstorno
		SD3->D3_NUMSEQ  := cNumSeq
		SD3->(MsUnlock())
	Endif

	SD3->(DbGoTo(nRecSeq))
	If RecLock("SD3", .F.)
		SD3->D3_ESTORNO := cEstorno
		SD3->(MsUnlock())
	Endif

return

/*/{Protheus.doc} enviaRespostaRequest

    M�todo respons�vel por devolver a mensagem da requisi��o em caso de falha.

    @author  Otaviano Mattos
    @param   cMensagem, recebe a mensagem de retorno
    @return  null, devolver a mensagem da requisi��o em caso de falha.
    @since   18-10-2021
/*/
method enviaRespostaRequest(cMensagem) class PecCodeEstoque

	default cMensagem := "Problema na execucao da operacao"

	SetRestFault(400, cMensagem)

return .F.

/*/{Protheus.doc} buscaCustosFixos

    M�todo respons�vel por buscar os custos fixos da pecu�ria

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  true, retorno padr�o do m�todo
    @since   18-10-2021
/*/
method buscaCustosFixos() class PecCodeEstoque

	local cAliasDBT := GetNextAlias()
	local cAliasCRD := GetNextAlias()
	local nPos := 0
	local nValConta := 0
	local aJson := {}
	local exCredito := ""
	local exDebito := ""
	local cExpSql := ""
	local wrk := JsonObject():new()

	If !self:converterPayloadParaJson()
		self:enviaRespostaRequest(self:cError)
		return .F.
	EndIf

	If !self:balancoValidaDados()
		return .F.
	EndIf

	self:cEmpresa         := self:normalizaEmpresa(self:valorJson("empresa"))
	self:cParamFil        := self:valorJson("filial")
	self:cClasseValorDe   := self:valorJson("classeinicial")
	self:cClasseValorAte  := self:valorJson("classefinal")
	self:cContaDe         := self:valorJson("containicial")
	self:cContaAte        := self:valorJson("contafinal")
	self:cCentroCustoDe   := self:valorJson("centrocustoinicio")
	self:cCentroCustoAte  := self:valorJson("centrocustofim")
	self:dDataLucPerda    := self:dataJson("datalucroperda")
	self:dDataInicial     := self:dataJson("datainicial")
	self:dDataFinal       := self:dataJson("datafinal")
	self:excecaocldebito  := self:valorJson("excecaocldebito")
	self:excecaoclcredito := self:valorJson("excecaoclcredito")

	If Empty(self:dDataLucPerda) .or. Empty(self:dDataInicial) .or. Empty(self:dDataFinal)
		self:enviaRespostaRequest("Uma ou mais datas informadas sao invalidas.")
		return .F.
	EndIf
	If self:dDataInicial > self:dDataFinal
		self:enviaRespostaRequest("A data inicial nao pode ser maior que a data final.")
		return .F.
	EndIf

	If Empty(self:cEmpresa) .or. !FWFilExist(self:cEmpresa, self:cParamFil)
		self:enviaRespostaRequest("A empresa/filial enviada nao existe.")
		return .F.
	EndIf

	// Ambiente REST (PrepareIn/OAuth). RpcSetEnv gera 500 no HTTPREST Cloud.
	If Len(AllTrim(self:cParamFil)) < TamSX3("B2_FILIAL")[1]
		self:cParamFil := PadR(self:cParamFil, TamSX3("B2_FILIAL")[1])
	EndIf
	cEmpAnt := self:cEmpresa
	cFilAnt := self:cParamFil

	cExpSql := " CT2.D_E_L_E_T_ = ' ' "

	if (!Empty(self:excecaocldebito))
		exDebito := " and ct2_debito not in ("+ self:excecaocldebito + ") "
	endif

	if (!Empty(self:excecaoclcredito))
		exCredito := " and ct2_credit not in ("+ self:excecaoclcredito + ") "
	endif

	cExpSql := cExpSql + exDebito + exCredito
	cExpSql := "%" + cExpSql + "%"

	BeginSql Alias cAliasDBT

		select ct2_debito, ct1_desc01, sum(ct2_valor) as valDbt
		from %TABLE:CT2% CT2
		inner join %TABLE:CT1% CT1 on ct1_conta = ct2_debito and CT1.%NOTDEL%
		where ct2_filial = %exp:self:cParamFil%
			and ct2_data between %exp:self:dDataInicial% and %exp:self:dDataFinal% 
			and ct2_debito between %exp:self:cContaDe% and %exp:self:cContaAte%
			and ct2_clvldb between %exp:self:cClasseValorDe% and %exp:self:cClasseValorAte%
			and ct2_ccd between %exp:self:cCentroCustoDe% and %exp:self:cCentroCustoAte%
			and %EXP:cExpSql%
		GROUP BY ct2_debito, ct1_desc01
	EndSql

	BeginSql Alias cAliasCRD

		select ct2_credit, ct1_desc01, sum(ct2_valor) as valCrd
		from %TABLE:CT2% CT2
		inner join %TABLE:CT1% CT1 on ct1_conta = ct2_credit and CT1.%NOTDEL%
		where ct2_filial = %exp:self:cParamFil%
			and ct2_data between %exp:self:dDataInicial% and %exp:self:dDataFinal% 
			and ct2_credit between %exp:self:cContaDe% and %exp:self:cContaAte%
			and ct2_clvlcr between %exp:self:cClasseValorDe% and %exp:self:cClasseValorAte%
			and ct2_ccc between %exp:self:cCentroCustoDe% and %exp:self:cCentroCustoAte%
			and %EXP:cExpSql%
		GROUP BY ct2_credit, ct1_desc01
	EndSql

	While( (cAliasDBT)->( ! EOF() ) )
		aAdd( aJson, JsonObject():New())
		nPos := Len(aJson)
		nValConta := (cAliasDBT)->valDbt
		
		(cAliasCRD)->(DBGOTOP())
		While( (cAliasCRD)->( ! EOF() ) )
			if ((cAliasDBT)->(ct2_debito) = (cAliasCRD)->(ct2_credit))
				nValConta -= (cAliasCRD)->valCrd
			endif
			(cAliasCRD)->( dbSkip() )
		End

		aJson[nPos]['conta' ] := AllTrim((cAliasDBT)->(ct2_debito))
		aJson[nPos]['valor' ] := nValConta
		aJson[nPos]['descricao' ] := (cAliasDBT)->ct1_desc01
		(cAliasDBT)->( dbSkip() )
	End


	wrk:set(aJson)
	self:oApiRest:SetResponse(EncodeUtf8('{"code":200,"custos":' + wrk:toJSON() + ',"response":"Busca custo fixo com sucesso."}'))

	(cAliasCRD)->( dbCloseArea() )
	(cAliasDBT)->( dbCloseArea() )

return .T.

/*/{Protheus.doc} buscaDadosBalancete

    M�todo respons�vel por buscar os dados do balancete

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  true, realiza a convers�o do payload para JSON Property
    @since   18-10-2021
/*/
method buscaDadosBalancete() class PecCodeEstoque

	Private nMeter         as numeric
	static cTabelaCTI      as character
	static cTabelaCTH      as character
	static cTipoSaldo      as character
	static cRecDesp        as character
	static cClasseValorDe  as character
	static cClasseValorAte as character
	static cContaDe        as character
	static cContaAte       as character
	static cMoeda          as character
	static dDataLucPerda   as date
	static dDataInicial    as date
	static dDataFinal      as date
	static l132            as logical
	static lValue1         as logical
	static lPosAntLP       as logical
	static lVlrZerado      as logical
	static lRecDesp0       as logical
	static lCtiSint        as logical
	static lTodasFil       as logical
	static aSetOfBook      as array
	static aSelFil         as array
	static nDivide         as numeric

	cTabelaCTI      := "CTI"
	cTabelaCTH      := "CTH"
	cTipoSaldo      := "1"
	cMoeda          := "01"
	cRecDesp        := "345"
	aSetOfBook      := {"","",0,"","","","","",1,"","",""}
	cClasseValorDe  := self:cClasseValorDe
	cClasseValorAte := self:cClasseValorAte
	cContaDe        := self:cContaDe
	cContaAte       := self:cContaAte
	dDataLucPerda   := self:dDataLucPerda
	dDataInicial    := self:dDataInicial
	dDataFinal      := self:dDataFinal
	aSelFil         := {self:cParamFil}
	l132            := .F.
	lValue1         := .T.
	lPosAntLP       := .F.
	lVlrZerado      := .F.
	lRecDesp0       := .T.
	lCtiSint        := .T.
	lTodasFil       := .F.
	nDivide         := 0
	nMeter          := 0

	CTGerPlan(Nil, Nil, Nil, Nil,@self:cArqTmp,;
		dDataInicial, dDataFinal, cTabelaCTI, "", cContaDe, cContaAte,,,,, cClasseValorDe, cClasseValorAte, cMoeda,;
		cTipoSaldo, aSetOfBook, "", "", "", "",;
		l132, lValue1,, cTabelaCTH, lPosAntLP, dDataLucPerda, nDivide, lVlrZerado,,,;
		"", "", "", "",,,,,,,,, "", lRecDesp0,;
		cRecDesp, (dDataInicial-1),,,,,,,,, aSelFil,,,,,,,, lCtiSint, lTodasFil)

return

/*/{Protheus.doc} balancoValidaDados

    M�todo respons�vel por validar o payload enviado na requisi��o

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  lRetorno, retorna se o payload � v�lido para prosseguir
    @since   18-10-2021
/*/
method balancoValidaDados() as logical class PecCodeEstoque

	local lRetorno        as logical
	local cPayload        as character
	local cParamFil         as character
	local cClasseValorDe  as character
	local cClasseValorAte as character
	local cContaDe        as character
	local cContaAte       as character
	local cDataLucPerda   as character
	local cDataInicial    as character
	local cDataFinal      as character

	lRetorno        := .T.
	cPayload        := self:cPayload
	cParamFil       := self:valorJson("filial")
	cClasseValorDe  := self:valorJson("classeinicial")
	cClasseValorAte := self:valorJson("classefinal")
	cContaDe        := self:valorJson("containicial")
	cContaAte       := self:valorJson("contafinal")
	cDataLucPerda   := self:valorJson("datalucroperda")
	cDataInicial    := self:valorJson("datainicial")
	cDataFinal      := self:valorJson("datafinal")

	DO CASE

	CASE Empty(cPayload)

		self:enviaRespostaRequest("Envie o body antes de continuar.")
		lRetorno := .F.

	CASE Empty(cClasseValorDe)

		self:enviaRespostaRequest("Envie a classe de valor inicial antes de continuar.")
		lRetorno := .F.

	CASE Empty(cClasseValorAte)

		self:enviaRespostaRequest("Envie a classe de valor final antes de continuar.")
		lRetorno := .F.

	CASE Empty(cContaDe)

		self:enviaRespostaRequest("Envie a conta inicial antes de continuar.")
		lRetorno := .F.

	CASE Empty(cContaAte)

		self:enviaRespostaRequest("Envie a conta final antes de continuar.")
		lRetorno := .F.

	CASE Empty(cDataLucPerda)

		self:enviaRespostaRequest("Envie a data de lucro e perda antes de continuar.")
		lRetorno := .F.

	CASE Empty(cDataInicial)

		self:enviaRespostaRequest("Envie a data inicial antes de continuar.")
		lRetorno := .F.

	CASE Empty(cDataFinal)

		self:enviaRespostaRequest("Envie a data final antes de continuar.")
		lRetorno := .F.

	CASE Empty(cParamFil)

		self:enviaRespostaRequest("Envie a filial antes de continuar.")
		lRetorno := .F.

	ENDCASE

return lRetorno

/*/{Protheus.doc} buscaValorTotalBalancete

    M�todo respons�vel por buscar o valor total do balancete

    @author  Otaviano Mattos
    @param   sem recep��o de par�metro
    @return  nRetorno, retorna a soma total do balancete
    @since   05-11-2021
/*/
method buscaValorTotalBalancete() class PecCodeEstoque

	local nRetorno as numeric

	nRetorno := 0

	(self:cArqTmp)->(DbGoTop())
	while (self:cArqTmp)->(!EOF())

		If(Empty((self:cArqTmp)->SUPERIOR))
			nRetorno += NoRound((self:cArqTmp)->SALDOATU, 2)
		EndIf

		(self:cArqTmp)->(DbSkip())

	end

	If Select("cArqTmp") > 0
		dbSelectArea("cArqTmp")
		(self:cArqTmp)->(dbCloseArea())

		If Select("cArqTmp") == 0
			FErase(self:cArqTmp+GetDBExtension())
			FErase("cArqInd"+OrdBagExt())
		EndIf
	EndIf

return nRetorno
