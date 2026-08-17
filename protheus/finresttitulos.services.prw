#include "totvs.ch"
#include "Restful.ch"

/*/{Protheus.doc} FinRestTitulosSvc
Regras de negocio para inclusao de titulos via FINA040/FINA050.

@author  Jean Oliveira
@since   04/08/2026
@type    class
/*/
Class FinRestTitulosSvc

	Data cPayload   As Character
	Data cError     As Character
	Data cErrorMsg  As Character
	Data cJsonRet   As Character
	Data lSuccess   As Logical
	Data oJson      As Object
	Data oApiRest   As Object
	Data cEmpSessao As Character
	Data cFilSessao As Character
	Data lAmbiente  As Logical

	Method New() Constructor
	Method IncluirReceber()
	Method IncluirPagar()
	Method Success()
	Method GetReturn()
	Method GetError()
	Method GetErrorMessage()
	Method ParsePayload()
	Method JsonText()
	Method JsonNum()
	Method ParseDate()
	Method TamCampo()
	Method PreparaAmbiente()
	Method RestauraAmbiente()
	Method AutoLog()
	Method RespOk()
	Method RespErro()
	Method ValidarBase()
	Method ExisteCliente()
	Method ExisteFornecedor()
	Method ExisteNatureza()
	Method GaranteCampo()
	Method ForcaFilialSE2()
	Method PosicionaPagar()
	Method PagarComMovimento()
	Method PagarFoiAlterado()
	Method TituloTemSE5()
	Method ApagaSE2Aberto()
	Method ExcluirPagar()
	Method CorrigeE1()
	Method PosicionaReceber()
	Method ReceberComMovimento()
	Method ReceberFoiAlterado()
	Method TemMovSE1()
	Method TemBaixaE1()
	Method ApagaSE1Aberto()
	Method ExcluirReceber()
	Method ConsultarReceber()
	Method IsoDate()
	Method ConsultarPagar()
	Method ConsultarFornecedores()
	Method ConsultarTipos()
	Method ConsultarClientes()
	Method FornecedorBloqueado()
	Method AddFornecedorItem()
	Method VarreSA2()
	Method ClienteBloqueado()
	Method AddClienteItem()
	Method VarreSA1()

EndClass

/*/{Protheus.doc} New
Construtor do servico de titulos.

@author  Jean Oliveira
@since   04/08/2026
@param   cBody, character, payload JSON
@param   oApi, object, instancia do WSREST
@return  object
/*/
Method New(cBody, oApi) Class FinRestTitulosSvc

	Default cBody := ""
	Default oApi  := Nil

	Self:cPayload   := cBody
	Self:cError     := ""
	Self:cErrorMsg  := ""
	Self:cJsonRet   := ""
	Self:lSuccess   := .T.
	Self:oJson      := Nil
	Self:oApiRest   := oApi
	Self:cEmpSessao := ""
	Self:cFilSessao := ""
	Self:lAmbiente  := .F.

Return Self

/*/{Protheus.doc} Success
Indica se a ultima operacao foi bem sucedida.
/*/
Method Success() Class FinRestTitulosSvc
Return Self:lSuccess

/*/{Protheus.doc} GetReturn
Retorna o JSON de sucesso.
/*/
Method GetReturn() Class FinRestTitulosSvc
Return Self:cJsonRet

/*/{Protheus.doc} GetError
Retorna a mensagem de erro.
/*/
Method GetError() Class FinRestTitulosSvc
Return Self:cError

Method GetErrorMessage() Class FinRestTitulosSvc

	If !Empty(Self:cErrorMsg)
		Return Self:cErrorMsg
	EndIf

Return "Falha ao incluir titulo"

/*/{Protheus.doc} ParsePayload
Converte o body JSON em objeto.
/*/
Method ParsePayload() Class FinRestTitulosSvc

	Local cErrJson := "" As Character

	If Empty(AllTrim(Self:cPayload))
		Self:RespErro("Payload JSON nao informado.")
		Return .F.
	EndIf

	Self:oJson := JsonObject():New()
	cErrJson := Self:oJson:fromJson(Self:cPayload)

	If ValType(cErrJson) == "C" .And. !Empty(cErrJson)
		Self:RespErro("JSON invalido: " + cErrJson)
		Return .F.
	EndIf

Return .T.

/*/{Protheus.doc} JsonText
Le propriedade texto do JSON.
/*/
Method JsonText(cKey) Class FinRestTitulosSvc

	Local cVal := "" As Character

	Default cKey := ""

	If Self:oJson == Nil
		Return ""
	EndIf

	cVal := AllTrim(cValToChar(Self:oJson:GetJsonText(cKey)))
	If Upper(cVal) == "NULL"
		cVal := ""
	EndIf

Return cVal

/*/{Protheus.doc} JsonNum
Le propriedade numerica do JSON.
/*/
Method JsonNum(cKey) Class FinRestTitulosSvc

	Local nVal := 0 As Numeric
	Local cVal := "" As Character

	Default cKey := ""

	If Self:oJson == Nil
		Return 0
	EndIf

	cVal := AllTrim(cValToChar(Self:oJson:GetJsonText(cKey)))
	If Empty(cVal) .Or. Upper(cVal) == "NULL"
		If ValType(Self:oJson[cKey]) == "N"
			nVal := Self:oJson[cKey]
		Else
			nVal := 0
		EndIf
	Else
		nVal := Val(StrTran(cVal, ",", "."))
	EndIf

Return nVal

/*/{Protheus.doc} ParseDate
Converte data DD/MM/AAAA ou AAAA-MM-DD.
/*/
Method ParseDate(cData) Class FinRestTitulosSvc

	Local dData := CToD("") As Date
	Local cAno  := "" As Character
	Local cMes  := "" As Character
	Local cDia  := "" As Character

	Default cData := ""

	cData := AllTrim(cData)
	If Empty(cData)
		Return CToD("")
	EndIf

	If "-" $ cData .And. Len(cData) >= 10
		cAno  := SubStr(cData, 1, 4)
		cMes  := SubStr(cData, 6, 2)
		cDia  := SubStr(cData, 9, 2)
		dData := CToD(cDia + "/" + cMes + "/" + cAno)
	Else
		dData := CToD(cData)
	EndIf

Return dData

/*/{Protheus.doc} TamCampo
Retorna tamanho do campo no SX3 com fallback.
/*/
Method TamCampo(cCampo, nDefault) Class FinRestTitulosSvc

	Local nTam := 0 As Numeric
	Local aTam As Array

	Default cCampo   := ""
	Default nDefault := 1

	aTam := TamSX3(cCampo)
	If ValType(aTam) == "A" .And. Len(aTam) >= 1 .And. ValType(aTam[1]) == "N" .And. aTam[1] > 0
		nTam := aTam[1]
	Else
		nTam := nDefault
	EndIf

Return nTam

/*/{Protheus.doc} PreparaAmbiente
Valida E2_FILIAL/E2_FILORIG. No Cloud REST nao altera cEmpAnt/cFilAnt
(troca de filial no job HTTP deixa 500 nas proximas requests).
A E2_FILIAL do JSON e gravada depois em ForcaFilialSE2.
Nao usa RpcSetEnv/FWSetSM0/FWFilExist.
/*/
Method PreparaAmbiente(cFilSE, cFilOrig) Class FinRestTitulosSvc

	Local cEmp     := "" As Character
	Local cFilPad  := "" As Character
	Local cUnidade := "01" As Character
	Local nTam     := 2 As Numeric

	Default cFilSE   := ""
	Default cFilOrig := ""

	cFilPad := AllTrim(cFilSE)
	If Empty(cFilPad) .Or. cFilPad == "00"
		Self:RespErro("Campo 'filial' e obrigatorio (E2_FILIAL).")
		Return .F.
	EndIf

	nTam := Self:TamCampo("E2_FILIAL", 2)
	If Len(cFilPad) < nTam
		cFilPad := PadR(cFilPad, nTam)
	EndIf
	cFilSE := cFilPad
	cEmp := Right("00" + AllTrim(cFilPad), 2)

	If Len(AllTrim(cFilOrig)) >= 4
		cUnidade := Right(AllTrim(cFilOrig), 2)
	ElseIf Len(AllTrim(cFilOrig)) == 2
		cUnidade := AllTrim(cFilOrig)
	EndIf
	If Empty(AllTrim(cFilOrig))
		cFilOrig := cEmp + cUnidade
	EndIf

	Self:lAmbiente := .F.

Return .T.

/*/{Protheus.doc} RestauraAmbiente
Devolve cEmpAnt/cFilAnt do PrepareIn. Evita 403 na proxima request HTTP.
/*/
Method RestauraAmbiente() Class FinRestTitulosSvc

	If Self:lAmbiente
		cEmpAnt := Self:cEmpSessao
		cFilAnt := Self:cFilSessao
		Self:lAmbiente := .F.
	EndIf

Return Nil

/*/{Protheus.doc} AutoLog
Extrai log do MsExecAuto.
/*/
Method AutoLog() Class FinRestTitulosSvc

	Local aLog := {} As Array
	Local cTxt := "" As Character
	Local nI   := 0 As Numeric

	If FindFunction("GetAutoGRLog")
		aLog := GetAutoGRLog()
	EndIf

	If ValType(aLog) == "A"
		For nI := 1 To Len(aLog)
			If nI > 20
				Exit
			EndIf
			If ValType(aLog[nI]) == "C" .And. !Empty(AllTrim(aLog[nI]))
				cTxt += AllTrim(aLog[nI]) + " | "
			EndIf
		Next
	EndIf

	If Empty(cTxt)
		cTxt := "(sem detalhe do ExecAuto - verifique tipo SX5, natureza, cliente/fornecedor e titulo duplicado)"
	EndIf

Return cTxt

/*/{Protheus.doc} RespOk
Monta resposta de sucesso TTALK-like.
/*/
Method RespOk(cTipo, cPrefixo, cNumero, cParcela, cTipoTit, cParceiro, cLoja, nValor, cFilRet) Class FinRestTitulosSvc

	Local oResp As Object

	Default cTipo     := ""
	Default cPrefixo  := ""
	Default cNumero   := ""
	Default cParcela  := ""
	Default cTipoTit  := ""
	Default cParceiro := ""
	Default cLoja     := ""
	Default nValor    := 0
	Default cFilRet   := ""

	If Empty(AllTrim(cFilRet))
		cFilRet := cFilAnt
	EndIf

	oResp := JsonObject():New()
	oResp["code"]            := "201"
	If "extornar" $ Lower(cTipo)
		oResp["message"] := "Titulo estornado com sucesso"
	Else
		oResp["message"] := "Titulo incluido com sucesso"
	EndIf
	oResp["tipoOperacao"]    := cTipo
	oResp["prefixo"]         := AllTrim(cPrefixo)
	oResp["numero"]          := AllTrim(cNumero)
	oResp["parcela"]         := AllTrim(cParcela)
	oResp["tipo"]            := AllTrim(cTipoTit)
	oResp["parceiro"]        := AllTrim(cParceiro)
	oResp["loja"]            := AllTrim(cLoja)
	oResp["valor"]           := nValor
	oResp["empresa"]         := AllTrim(cEmpAnt)
	oResp["filial"]          := AllTrim(cFilRet)

	Self:lSuccess  := .T.
	Self:cJsonRet  := oResp:ToJson()
	Self:cError    := ""
	Self:cErrorMsg := ""

Return Nil

/*/{Protheus.doc} RespErro
Monta resposta de erro.
/*/
Method RespErro(cMsg) Class FinRestTitulosSvc

	Local oResp As Object

	Default cMsg := "Erro nao informado"

	oResp := JsonObject():New()
	oResp["code"]            := "400"
	oResp["message"]         := cMsg
	oResp["detailedMessage"] := cMsg

	Self:lSuccess  := .F.
	Self:cErrorMsg := cMsg
	Self:cError    := oResp:ToJson()
	Self:cJsonRet  := ""

	FWLogMsg("ERROR", , "REST", "FinRestTitulos", , "01", cMsg, 0, 0, {})

Return Nil

/*/{Protheus.doc} ValidarBase
Valida campos obrigatorios comuns.
/*/
Method ValidarBase(cNumero, cTipo, cNatureza, cLoja, dEmissao, dVencto, nValor) Class FinRestTitulosSvc

	Default cNumero   := ""
	Default cTipo     := ""
	Default cNatureza := ""
	Default cLoja     := ""
	Default dEmissao  := CToD("")
	Default dVencto   := CToD("")
	Default nValor    := 0

	If Empty(cNumero)
		Self:RespErro("Campo 'numero' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cTipo)
		Self:RespErro("Campo 'tipo' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cNatureza)
		Self:RespErro("Campo 'natureza' e obrigatorio e deve ser o ED_CODIGO, nao a descricao.")
		Return .F.
	EndIf
	If Empty(cLoja)
		Self:RespErro("Campo 'loja' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(dEmissao)
		Self:RespErro("Campo 'emissao' invalido. Use DD/MM/AAAA ou AAAA-MM-DD.")
		Return .F.
	EndIf
	If Empty(dVencto)
		Self:RespErro("Campo 'vencimento' invalido. Use DD/MM/AAAA ou AAAA-MM-DD.")
		Return .F.
	EndIf
	If nValor <= 0
		Self:RespErro("Campo 'valor' deve ser maior que zero.")
		Return .F.
	EndIf

Return .T.

/*/{Protheus.doc} ExisteCliente
Valida cliente na SA1.
/*/
Method ExisteCliente(cCliente, cLoja) Class FinRestTitulosSvc

	Local aArea As Array
	Local lOk   := .F. As Logical

	Default cCliente := ""
	Default cLoja    := ""

	aArea := GetArea()
	Begin Sequence
		DbSelectArea("SA1")
		SA1->(DbSetOrder(1))
		lOk := SA1->(DbSeek(xFilial("SA1") + PadR(cCliente, Self:TamCampo("A1_COD", 6)) + PadR(cLoja, Self:TamCampo("A1_LOJA", 2))))
	Recover
		lOk := .F.
	End Sequence
	RestArea(aArea)

Return lOk

/*/{Protheus.doc} ExisteFornecedor
Valida fornecedor na SA2.
/*/
Method ExisteFornecedor(cFornece, cLoja) Class FinRestTitulosSvc

	Local aArea As Array
	Local lOk   := .F. As Logical

	Default cFornece := ""
	Default cLoja    := ""

	aArea := GetArea()
	Begin Sequence
		DbSelectArea("SA2")
		SA2->(DbSetOrder(1))
		lOk := SA2->(DbSeek(xFilial("SA2") + PadR(cFornece, Self:TamCampo("A2_COD", 6)) + PadR(cLoja, Self:TamCampo("A2_LOJA", 2))))
	Recover
		lOk := .F.
	End Sequence
	RestArea(aArea)

Return lOk

/*/{Protheus.doc} ExisteNatureza
Valida natureza na SED.
/*/
Method ExisteNatureza(cNatureza) Class FinRestTitulosSvc

	Local aArea As Array
	Local lOk   := .F. As Logical

	Default cNatureza := ""

	aArea := GetArea()
	Begin Sequence
		DbSelectArea("SED")
		SED->(DbSetOrder(1))
		lOk := SED->(DbSeek(xFilial("SED") + PadR(cNatureza, Self:TamCampo("ED_CODIGO", 10))))
	Recover
		lOk := .F.
	End Sequence
	RestArea(aArea)

Return lOk

/*/{Protheus.doc} IncluirReceber
Inclui titulo a receber (SE1) via FINA040 / opcao 3.
Garante E1_FILIAL do JSON (M0_CODIGO). Nao muta cFilAnt.
/*/
Method IncluirReceber() Class FinRestTitulosSvc

	Local aCampos   := {} As Array
	Local cFilAux   := "" As Character
	Local cPrefixo  := "" As Character
	Local cNumero   := "" As Character
	Local cParcela  := "" As Character
	Local cTipo     := "" As Character
	Local cNatureza := "" As Character
	Local cCliente  := "" As Character
	Local cLoja     := "" As Character
	Local cHist     := "" As Character
	Local cCC       := "" As Character
	Local cFilOrig  := "" As Character
	Local cNome     := "" As Character
	Local cFilSE    := "" As Character
	Local cLog      := "" As Character
	Local dEmissao  := CToD("") As Date
	Local dVencto   := CToD("") As Date
	Local nValor    := 0 As Numeric
	Local nMoeda    := 1 As Numeric
	Local lErro     := .F. As Logical

	Private lMsErroAuto := .F.
	Private lMsHelpAuto := .T.
	Private lAutoErrNoFile := .T.

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cFilAux   := Self:JsonText("filial")
	cPrefixo  := Self:JsonText("prefixo")
	cNumero   := Self:JsonText("numero")
	cParcela  := Self:JsonText("parcela")
	cTipo     := Self:JsonText("tipo")
	cNatureza := Self:JsonText("natureza")
	cCliente  := Self:JsonText("cliente")
	cLoja     := Self:JsonText("loja")
	cHist     := Self:JsonText("historico")
	cCC       := Self:JsonText("centroCusto")
	cFilOrig  := Self:JsonText("filOrig")
	dEmissao  := Self:ParseDate(Self:JsonText("emissao"))
	dVencto   := Self:ParseDate(Self:JsonText("vencimento"))
	nValor    := Self:JsonNum("valor")
	nMoeda    := Self:JsonNum("moeda")

	If nMoeda <= 0
		nMoeda := 1
	EndIf
	If Empty(cParcela)
		cParcela := "1"
	EndIf
	If !Self:ValidarBase(cNumero, cTipo, cNatureza, cLoja, dEmissao, dVencto, nValor)
		Return .F.
	EndIf
	If Empty(cCliente)
		Self:RespErro("Campo 'cliente' e obrigatorio para titulo a receber.")
		Return .F.
	EndIf
	If !Self:ExisteCliente(cCliente, cLoja)
		Self:RespErro("Cliente/loja nao encontrado: " + AllTrim(cCliente) + "/" + AllTrim(cLoja))
		Return .F.
	EndIf
	If !Self:ExisteNatureza(cNatureza)
		Self:RespErro("Natureza nao encontrada (use ED_CODIGO): " + AllTrim(cNatureza))
		Return .F.
	EndIf
	If !Self:PreparaAmbiente(@cFilAux, @cFilOrig)
		Return .F.
	EndIf

	cFilSE := PadR(cFilAux, Self:TamCampo("E1_FILIAL", 2))

	AAdd(aCampos, {"E1_FILIAL" , cFilSE, Nil})
	AAdd(aCampos, {"E1_PREFIXO", PadR(cPrefixo, Self:TamCampo("E1_PREFIXO", 3)), Nil})
	AAdd(aCampos, {"E1_NUM"    , PadR(cNumero, Self:TamCampo("E1_NUM", 9)), Nil})
	AAdd(aCampos, {"E1_PARCELA", PadR(cParcela, Self:TamCampo("E1_PARCELA", 2)), Nil})
	AAdd(aCampos, {"E1_TIPO"   , PadR(cTipo, Self:TamCampo("E1_TIPO", 3)), Nil})
	AAdd(aCampos, {"E1_NATUREZ", PadR(cNatureza, Self:TamCampo("E1_NATUREZ", 10)), Nil})
	AAdd(aCampos, {"E1_CLIENTE", PadR(cCliente, Self:TamCampo("E1_CLIENTE", 6)), Nil})
	AAdd(aCampos, {"E1_LOJA"   , PadR(cLoja, Self:TamCampo("E1_LOJA", 2)), Nil})
	AAdd(aCampos, {"E1_EMISSAO", dEmissao, Nil})
	AAdd(aCampos, {"E1_VENCTO" , dVencto, Nil})
	AAdd(aCampos, {"E1_VENCREA", DataValida(dVencto, .T.), Nil})
	AAdd(aCampos, {"E1_VALOR"  , nValor, Nil})
	AAdd(aCampos, {"E1_MOEDA"  , nMoeda, Nil})

	If !Empty(cHist)
		AAdd(aCampos, {"E1_HIST", PadR(cHist, Self:TamCampo("E1_HIST", 40)), Nil})
	EndIf

	Begin Sequence
		DbSelectArea("SE1")
		SE1->(DbSetOrder(1))
	Recover
		Self:RespErro("Nao foi possivel abrir o SE1 no job REST.")
		Self:RestauraAmbiente()
		Return .F.
	End Sequence

	If !Empty(cFilOrig) .And. SE1->(FieldPos("E1_FILORIG")) > 0
		AAdd(aCampos, {"E1_FILORIG", PadR(cFilOrig, Self:TamCampo("E1_FILORIG", 4)), Nil})
	EndIf

	cNome := AllTrim(Posicione("SA1", 1, xFilial("SA1") + PadR(cCliente, Self:TamCampo("A1_COD", 6)) + PadR(cLoja, Self:TamCampo("A1_LOJA", 2)), "A1_NREDUZ"))
	If Empty(cNome)
		cNome := AllTrim(Posicione("SA1", 1, xFilial("SA1") + PadR(cCliente, Self:TamCampo("A1_COD", 6)) + PadR(cLoja, Self:TamCampo("A1_LOJA", 2)), "A1_NOME"))
	EndIf
	If !Empty(cNome)
		If SE1->(FieldPos("E1_NOMCLI")) > 0
			AAdd(aCampos, {"E1_NOMCLI", PadR(cNome, Self:TamCampo("E1_NOMCLI", 20)), Nil})
		EndIf
	EndIf

	If !Empty(cCC)
		If SE1->(FieldPos("E1_CCD")) > 0
			AAdd(aCampos, {"E1_CCD", PadR(cCC, Self:TamCampo("E1_CCD", 9)), Nil})
		ElseIf SE1->(FieldPos("E1_CCUSTO")) > 0
			AAdd(aCampos, {"E1_CCUSTO", PadR(cCC, Self:TamCampo("E1_CCUSTO", 9)), Nil})
		EndIf
	EndIf

	aCampos := FWVetByDic(aCampos, "SE1", .F.)
	Self:GaranteCampo(@aCampos, "E1_FILIAL", cFilSE)

	Begin Sequence
		Begin Transaction
			MsExecAuto({|a, n| FINA040(a, n)}, aCampos, 3)
			If lMsErroAuto
				DisarmTransaction()
			EndIf
		End Transaction

		lErro := lMsErroAuto
		cLog := Self:AutoLog()

		If !lErro
			If Self:CorrigeE1(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
				Self:RespOk("receber", cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja, nValor, AllTrim(SE1->E1_FILIAL))
			Else
				If Self:PosicionaReceber(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
					Self:ApagaSE1Aberto()
				EndIf
				Self:RespErro("FINA040 gravou E1_FILIAL da sessao HTTP. Nao foi possivel corrigir para " + AllTrim(cFilSE) + ".")
			EndIf
		ElseIf ("FA040NUM" $ Upper(cLog) .Or. "JA EXISTE" $ Upper(cLog)) .And. Self:PosicionaReceber(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
			If Self:CorrigeE1(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
				Self:RespOk("receber", cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja, nValor, AllTrim(SE1->E1_FILIAL))
			ElseIf AllTrim(SE1->E1_FILIAL) <> AllTrim(cFilSE) .And. Self:ApagaSE1Aberto()
				lMsErroAuto := .F.
				Begin Sequence
					Begin Transaction
						MsExecAuto({|a, n| FINA040(a, n)}, aCampos, 3)
						If lMsErroAuto
							DisarmTransaction()
						EndIf
					End Transaction
				Recover
					lMsErroAuto := .T.
				End Sequence
				If !lMsErroAuto .And. Self:CorrigeE1(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
					Self:RespOk("receber", cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja, nValor, AllTrim(SE1->E1_FILIAL))
				Else
					Self:RespErro("Titulo ja existia na filial da sessao HTTP. Nao foi possivel regravar com E1_FILIAL=" + AllTrim(cFilSE) + ".")
				EndIf
			Else
				Self:RespErro("Titulo ja existe no SE1 com E1_FILIAL=" + AllTrim(SE1->E1_FILIAL) + ". Esperado " + AllTrim(cFilSE) + ".")
			EndIf
		Else
			Self:RespErro("FINA040 recusou o titulo a receber. " + cLog)
		EndIf
	Recover
		Self:RespErro("FINA040 quebrou no job HTTP REST. Reinicie o job e recompile FinRestTitulos.")
	End Sequence

	Self:RestauraAmbiente()

Return Self:lSuccess

/*/{Protheus.doc} IncluirPagar
Inclui titulo a pagar (SE2) via FINA050 / opcao 3.
/*/
Method IncluirPagar() Class FinRestTitulosSvc

	Local aCampos   := {} As Array
	Local cFilAux   := "" As Character
	Local cPrefixo  := "" As Character
	Local cNumero   := "" As Character
	Local cParcela  := "" As Character
	Local cTipo     := "" As Character
	Local cNatureza := "" As Character
	Local cFornece  := "" As Character
	Local cLoja     := "" As Character
	Local cHist     := "" As Character
	Local cCC       := "" As Character
	Local cFilOrig  := "" As Character
	Local cNome     := "" As Character
	Local cFilSE    := "" As Character
	Local cLog      := "" As Character
	Local dEmissao  := CToD("") As Date
	Local dVencto   := CToD("") As Date
	Local nValor    := 0 As Numeric
	Local nMoeda    := 1 As Numeric
	Local lErro     := .F. As Logical

	Private lMsErroAuto := .F.
	Private lMsHelpAuto := .T.
	Private lAutoErrNoFile := .T.

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cFilAux   := Self:JsonText("filial")
	cPrefixo  := Self:JsonText("prefixo")
	cNumero   := Self:JsonText("numero")
	cParcela  := Self:JsonText("parcela")
	cTipo     := Self:JsonText("tipo")
	cNatureza := Self:JsonText("natureza")
	cFornece  := Self:JsonText("fornecedor")
	cLoja     := Self:JsonText("loja")
	cHist     := Self:JsonText("historico")
	cCC       := Self:JsonText("centroCusto")
	cFilOrig  := Self:JsonText("filOrig")
	dEmissao  := Self:ParseDate(Self:JsonText("emissao"))
	dVencto   := Self:ParseDate(Self:JsonText("vencimento"))
	nValor    := Self:JsonNum("valor")
	nMoeda    := Self:JsonNum("moeda")

	If nMoeda <= 0
		nMoeda := 1
	EndIf
	If Empty(cParcela)
		cParcela := "1"
	EndIf
	If !Self:ValidarBase(cNumero, cTipo, cNatureza, cLoja, dEmissao, dVencto, nValor)
		Return .F.
	EndIf
	If Empty(cFornece)
		Self:RespErro("Campo 'fornecedor' e obrigatorio para titulo a pagar.")
		Return .F.
	EndIf
	If !Self:ExisteFornecedor(cFornece, cLoja)
		Self:RespErro("Fornecedor/loja nao encontrado: " + AllTrim(cFornece) + "/" + AllTrim(cLoja))
		Return .F.
	EndIf
	If !Self:ExisteNatureza(cNatureza)
		Self:RespErro("Natureza nao encontrada (use ED_CODIGO): " + AllTrim(cNatureza))
		Return .F.
	EndIf
	If !Self:PreparaAmbiente(@cFilAux, @cFilOrig)
		Return .F.
	EndIf

	cFilSE := PadR(cFilAux, Self:TamCampo("E2_FILIAL", 2))

	AAdd(aCampos, {"E2_FILIAL" , cFilSE, Nil})
	AAdd(aCampos, {"E2_PREFIXO", PadR(cPrefixo, Self:TamCampo("E2_PREFIXO", 3)), Nil})
	AAdd(aCampos, {"E2_NUM"    , PadR(cNumero, Self:TamCampo("E2_NUM", 9)), Nil})
	AAdd(aCampos, {"E2_PARCELA", PadR(cParcela, Self:TamCampo("E2_PARCELA", 2)), Nil})
	AAdd(aCampos, {"E2_TIPO"   , PadR(cTipo, Self:TamCampo("E2_TIPO", 3)), Nil})
	AAdd(aCampos, {"E2_NATUREZ", PadR(cNatureza, Self:TamCampo("E2_NATUREZ", 10)), Nil})
	AAdd(aCampos, {"E2_FORNECE", PadR(cFornece, Self:TamCampo("E2_FORNECE", 6)), Nil})
	AAdd(aCampos, {"E2_LOJA"   , PadR(cLoja, Self:TamCampo("E2_LOJA", 2)), Nil})
	AAdd(aCampos, {"E2_EMISSAO", dEmissao, Nil})
	AAdd(aCampos, {"E2_VENCTO" , dVencto, Nil})
	AAdd(aCampos, {"E2_VENCREA", DataValida(dVencto, .T.), Nil})
	AAdd(aCampos, {"E2_VALOR"  , nValor, Nil})
	AAdd(aCampos, {"E2_MOEDA"  , nMoeda, Nil})

	If !Empty(cHist)
		AAdd(aCampos, {"E2_HIST", PadR(cHist, Self:TamCampo("E2_HIST", 40)), Nil})
	EndIf

	Begin Sequence
		DbSelectArea("SE2")
		SE2->(DbSetOrder(1))
	Recover
		Self:RespErro("Nao foi possivel abrir o SE2 no job REST.")
		Self:RestauraAmbiente()
		Return .F.
	End Sequence

	If !Empty(cFilOrig) .And. SE2->(FieldPos("E2_FILORIG")) > 0
		AAdd(aCampos, {"E2_FILORIG", PadR(cFilOrig, Self:TamCampo("E2_FILORIG", 4)), Nil})
	EndIf

	cNome := AllTrim(Posicione("SA2", 1, xFilial("SA2") + PadR(cFornece, Self:TamCampo("A2_COD", 6)) + PadR(cLoja, Self:TamCampo("A2_LOJA", 2)), "A2_NREDUZ"))
	If Empty(cNome)
		cNome := AllTrim(Posicione("SA2", 1, xFilial("SA2") + PadR(cFornece, Self:TamCampo("A2_COD", 6)) + PadR(cLoja, Self:TamCampo("A2_LOJA", 2)), "A2_NOME"))
	EndIf
	If !Empty(cNome)
		If SE2->(FieldPos("E2_NOMFOR")) > 0
			AAdd(aCampos, {"E2_NOMFOR", PadR(cNome, Self:TamCampo("E2_NOMFOR", 20)), Nil})
		EndIf
	EndIf

	If !Empty(cCC)
		If SE2->(FieldPos("E2_CCD")) > 0
			AAdd(aCampos, {"E2_CCD", PadR(cCC, Self:TamCampo("E2_CCD", 9)), Nil})
		ElseIf SE2->(FieldPos("E2_CCUSTO")) > 0
			AAdd(aCampos, {"E2_CCUSTO", PadR(cCC, Self:TamCampo("E2_CCUSTO", 9)), Nil})
		EndIf
	EndIf

	aCampos := FWVetByDic(aCampos, "SE2", .F.)
	Self:GaranteCampo(@aCampos, "E2_FILIAL", cFilSE)

	Begin Sequence
		Begin Transaction
			MsExecAuto({|a, n| FINA050(a, n)}, aCampos, 3)
			If lMsErroAuto
				DisarmTransaction()
			EndIf
		End Transaction

		lErro := lMsErroAuto
		cLog := Self:AutoLog()

		If !lErro
			If Self:ForcaFilialSE2(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
				Self:RespOk("pagar", cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja, nValor, AllTrim(SE2->E2_FILIAL))
			Else
				If Self:PosicionaPagar(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
					Self:ApagaSE2Aberto()
				EndIf
				Self:RespErro("FINA050 gravou E2_FILIAL da sessao HTTP. Nao foi possivel corrigir para " + AllTrim(cFilSE) + ".")
			EndIf
		ElseIf ("FA050NUM" $ Upper(cLog) .Or. "JA EXISTE" $ Upper(cLog)) .And. Self:PosicionaPagar(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
			If Self:ForcaFilialSE2(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
				Self:RespOk("pagar", cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja, nValor, AllTrim(SE2->E2_FILIAL))
			Else
				Self:RespErro("Titulo ja existe no SE2 com E2_FILIAL=" + AllTrim(SE2->E2_FILIAL) + ". Esperado " + AllTrim(cFilSE) + ".")
			EndIf
		Else
			Self:RespErro("FINA050 recusou o titulo a pagar. " + cLog)
		EndIf
	Recover
		Self:RespErro("FINA050 quebrou no job HTTP REST. Reinicie o job e recompile FinRestTitulos.")
	End Sequence

	Self:RestauraAmbiente()

Return Self:lSuccess

/*/{Protheus.doc} GaranteCampo
Reinsere campo que o FWVetByDic possa ter removido (ex.: E2_FILIAL).
/*/
Method GaranteCampo(aCampos, cCampo, xValor) Class FinRestTitulosSvc

	Local nPos := 0 As Numeric

	Default cCampo := ""

	nPos := AScan(aCampos, {|x| AllTrim(x[1]) == AllTrim(cCampo)})
	If nPos == 0
		AAdd(aCampos, {cCampo, xValor, Nil})
	Else
		aCampos[nPos, 2] := xValor
	EndIf

Return Nil

/*/{Protheus.doc} ForcaFilialSE2
Garante E2_FILIAL do JSON. O FINA050 grava a filial da sessao HTTP (01).
Corrige para a filial do titulo (M0_CODIGO, ex. 03) se nao houver movimento.
So retorna .T. se o SE2 posicionado tiver E2_FILIAL igual ao pedido.
/*/
Method ForcaFilialSE2(cFilWant, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja) Class FinRestTitulosSvc

	Local cWant := "" As Character
	Local cSuf  := "" As Character
	Local nTam  := 2 As Numeric
	Local nRec  := 0 As Numeric
	Local lOk   := .F. As Logical
	Local lLock := .F. As Logical

	Default cFilWant := ""
	Default cFilOrig := ""
	Default cPrefixo := ""
	Default cNumero  := ""
	Default cParcela := ""
	Default cTipo    := ""
	Default cFornece := ""
	Default cLoja    := ""

	If !Self:PosicionaPagar(cFilWant, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
		Return .F.
	EndIf

	nTam := Self:TamCampo("E2_FILIAL", 2)
	cWant := PadR(AllTrim(cFilWant), nTam)
	cSuf := PadR(cPrefixo, Self:TamCampo("E2_PREFIXO", 3))
	cSuf += PadR(cNumero, Self:TamCampo("E2_NUM", 9))
	cSuf += PadR(cParcela, Self:TamCampo("E2_PARCELA", 2))
	cSuf += PadR(cTipo, Self:TamCampo("E2_TIPO", 3))
	cSuf += PadR(cFornece, Self:TamCampo("E2_FORNECE", 6))
	cSuf += PadR(cLoja, Self:TamCampo("E2_LOJA", 2))

	If AllTrim(SE2->E2_FILIAL) == AllTrim(cWant)
		If SE2->(FieldPos("E2_FILORIG")) > 0 .And. !Empty(cFilOrig) .And. AllTrim(SE2->E2_FILORIG) <> AllTrim(cFilOrig)
			Begin Sequence
				If RecLock("SE2", .F.)
					Replace E2_FILORIG With PadR(cFilOrig, Self:TamCampo("E2_FILORIG", 4))
					SE2->(MsUnlock())
					SE2->(DbCommit())
				EndIf
			Recover
				SE2->(MsUnlock())
			End Sequence
		EndIf
		Return .T.
	EndIf

	If Self:PagarComMovimento()
		Return .F.
	EndIf

	nRec := SE2->(Recno())
	Begin Sequence
		If RecLock("SE2", .F.)
			Replace E2_FILIAL With cWant
			If SE2->(FieldPos("E2_FILORIG")) > 0 .And. !Empty(cFilOrig)
				Replace E2_FILORIG With PadR(cFilOrig, Self:TamCampo("E2_FILORIG", 4))
			EndIf
			SE2->(MsUnlock())
			SE2->(DbCommit())
			lLock := .T.
		EndIf
	Recover
		lLock := .F.
		SE2->(MsUnlock())
	End Sequence

	If !lLock
		Return .F.
	EndIf

	Begin Sequence
		DbSelectArea("SE2")
		SE2->(DbSetOrder(1))
		If SE2->(DbSeek(cWant + cSuf))
			lOk := AllTrim(SE2->E2_FILIAL) == AllTrim(cWant)
		ElseIf nRec > 0
			SE2->(DbGoTo(nRec))
			lOk := AllTrim(SE2->E2_FILIAL) == AllTrim(cWant)
		EndIf
	Recover
		lOk := .F.
	End Sequence

Return lOk

/*/{Protheus.doc} PosicionaPagar
Localiza SE2 pela chave. Tenta a filial do JSON, 03, 01 e o sufixo de filOrig.
Nao usa SetDeleted nem D_E_L_E_T_ (500 no Cloud REST).
/*/
Method PosicionaPagar(cFilWant, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja) Class FinRestTitulosSvc

	Local aFils := {} As Array
	Local cSuf  := "" As Character
	Local cTry  := "" As Character
	Local nI    := 0 As Numeric
	Local nTam  := 2 As Numeric
	Local lOk   := .F. As Logical

	Default cFilWant := ""
	Default cFilOrig := ""
	Default cPrefixo := ""
	Default cNumero  := ""
	Default cParcela := ""
	Default cTipo    := ""
	Default cFornece := ""
	Default cLoja    := ""

	nTam := Self:TamCampo("E2_FILIAL", 2)
	cSuf := PadR(cPrefixo, Self:TamCampo("E2_PREFIXO", 3))
	cSuf += PadR(cNumero, Self:TamCampo("E2_NUM", 9))
	cSuf += PadR(cParcela, Self:TamCampo("E2_PARCELA", 2))
	cSuf += PadR(cTipo, Self:TamCampo("E2_TIPO", 3))
	cSuf += PadR(cFornece, Self:TamCampo("E2_FORNECE", 6))
	cSuf += PadR(cLoja, Self:TamCampo("E2_LOJA", 2))

	AAdd(aFils, PadR(AllTrim(cFilWant), nTam))
	If Type("cFilAnt") == "C" .And. !Empty(AllTrim(cFilAnt))
		AAdd(aFils, PadR(AllTrim(cFilAnt), nTam))
	EndIf
	AAdd(aFils, PadR("03", nTam))
	AAdd(aFils, PadR("01", nTam))
	If Len(AllTrim(cFilOrig)) >= 2
		AAdd(aFils, PadR(Right(AllTrim(cFilOrig), 2), nTam))
	EndIf

	Begin Sequence
		DbSelectArea("SE2")
		SE2->(DbSetOrder(1))
	Recover
		Return .F.
	End Sequence

	For nI := 1 To Len(aFils)
		cTry := aFils[nI]
		If Empty(AllTrim(cTry))
			Loop
		EndIf
		If nI > 1 .And. AScan(aFils, cTry) < nI
			Loop
		EndIf
		Begin Sequence
			If SE2->(DbSeek(cTry + cSuf))
				lOk := .T.
			EndIf
		Recover
			lOk := .F.
		End Sequence
		If lOk
			nI := Len(aFils)
		EndIf
	Next

Return lOk

/*/{Protheus.doc} PagarComMovimento
Titulo com baixa, bordero, valor liquidado ou saldo diferente nao pode ser estornado.
/*/
Method PagarComMovimento() Class FinRestTitulosSvc

	Local cFlag := "" As Character

	If Abs(SE2->E2_SALDO - SE2->E2_VALOR) > 0.009
		Return .T.
	EndIf
	If !Empty(SE2->E2_BAIXA)
		Return .T.
	EndIf
	If SE2->(FieldPos("E2_VALLIQ")) > 0 .And. SE2->E2_VALLIQ > 0
		Return .T.
	EndIf
	If SE2->(FieldPos("E2_MOVIMEN")) > 0 .And. !Empty(SE2->E2_MOVIMEN)
		Return .T.
	EndIf
	If SE2->(FieldPos("E2_NUMBOR")) > 0 .And. !Empty(AllTrim(SE2->E2_NUMBOR))
		Return .T.
	EndIf
	If SE2->(FieldPos("E2_IDCNAB")) > 0 .And. !Empty(AllTrim(SE2->E2_IDCNAB))
		Return .T.
	EndIf
	If SE2->(FieldPos("E2_LA")) > 0
		cFlag := AllTrim(Upper(SE2->E2_LA))
		If cFlag == "S" .Or. cFlag == "1"
			Return .T.
		EndIf
	EndIf
	If SE2->(FieldPos("E2_FATURA")) > 0 .And. !Empty(AllTrim(SE2->E2_FATURA))
		Return .T.
	EndIf
	If Self:TituloTemSE5()
		Return .T.
	EndIf

Return .F.

/*/{Protheus.doc} TituloTemSE5
Titulo com movimento no SE5 (baixa/bordero) nao pode ser estornado.
/*/
Method TituloTemSE5() Class FinRestTitulosSvc

	Local aArea  As Array
	Local cChave := "" As Character
	Local lMov   := .F. As Logical

	aArea := GetArea()
	DbSelectArea("SE5")
	Begin Sequence
		SE5->(DbSetOrder(7))
		cChave := PadR(SE2->E2_FILIAL, Self:TamCampo("E5_FILIAL", 2))
		cChave += PadR(SE2->E2_PREFIXO, Self:TamCampo("E5_PREFIXO", 3))
		cChave += PadR(SE2->E2_NUM, Self:TamCampo("E5_NUMERO", 9))
		cChave += PadR(SE2->E2_PARCELA, Self:TamCampo("E5_PARCELA", 2))
		cChave += PadR(SE2->E2_TIPO, Self:TamCampo("E5_TIPO", 3))
		cChave += PadR(SE2->E2_FORNECE, Self:TamCampo("E5_CLIFOR", 6))
		cChave += PadR(SE2->E2_LOJA, Self:TamCampo("E5_LOJA", 2))
		If SE5->(DbSeek(cChave))
			lMov := .T.
		EndIf
	Recover
		lMov := .F.
	End Sequence
	RestArea(aArea)

Return lMov

/*/{Protheus.doc} PagarFoiAlterado
Compara o SE2 com o payload do FinCalc. Recusa estorno se valor, natureza
ou vencimento tiverem mudado no Protheus.
/*/
Method PagarFoiAlterado(nValor, cNatureza, dVencto) Class FinRestTitulosSvc

	Default nValor    := 0
	Default cNatureza := ""
	Default dVencto   := CToD("")

	If nValor > 0 .And. Abs(SE2->E2_VALOR - nValor) > 0.009
		Return .T.
	EndIf
	If !Empty(AllTrim(cNatureza)) .And. SE2->(FieldPos("E2_NATUREZ")) > 0
		If AllTrim(SE2->E2_NATUREZ) <> AllTrim(cNatureza)
			Return .T.
		EndIf
	EndIf
	If !Empty(dVencto) .And. SE2->E2_VENCTO <> dVencto
		Return .T.
	EndIf

Return .F.

/*/{Protheus.doc} ApagaSE2Aberto
Estorna o SE2 posicionado com DbDelete(). No Protheus isso grava
D_E_L_E_T_ = '*'. Nao acessar o campo D_E_L_E_T_ (500 no Cloud REST).
/*/
Method ApagaSE2Aberto() Class FinRestTitulosSvc

	Local lOk := .F. As Logical

	If Self:PagarComMovimento()
		Return .F.
	EndIf

	Begin Sequence
		If RecLock("SE2", .F.)
			SE2->(DbDelete())
			SE2->(MsUnlock())
			SE2->(DbCommit())
			lOk := .T.
		EndIf
	Recover
		lOk := .F.
		SE2->(MsUnlock())
	End Sequence

Return lOk

/*/{Protheus.doc} ExcluirPagar
Estorna titulo a pagar sem movimentacao nem alteracao.
Grava D_E_L_E_T_ = '*' no SE2 (03 e 01, se houver copia).
/*/
Method ExcluirPagar() Class FinRestTitulosSvc

	Local cFilAux   := "" As Character
	Local cPrefixo  := "" As Character
	Local cNumero   := "" As Character
	Local cParcela  := "" As Character
	Local cTipo     := "" As Character
	Local cFornece  := "" As Character
	Local cLoja     := "" As Character
	Local cFilOrig  := "" As Character
	Local cFilSE    := "" As Character
	Local nValor    := 0 As Numeric
	Local nValorEsp := 0 As Numeric
	Local cNaturEsp := "" As Character
	Local dVenctoEsp := CToD("") As Date
	Local lErro     := .F. As Logical
	Local nCopia    := 0 As Numeric

	Private lMsErroAuto := .F.
	Private lMsHelpAuto := .T.
	Private lAutoErrNoFile := .T.

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cFilAux  := Self:JsonText("filial")
	cPrefixo := Self:JsonText("prefixo")
	cNumero  := Self:JsonText("numero")
	cParcela := Self:JsonText("parcela")
	cTipo    := Self:JsonText("tipo")
	cFornece := Self:JsonText("fornecedor")
	cLoja    := Self:JsonText("loja")
	cFilOrig := Self:JsonText("filOrig")
	nValorEsp  := Self:JsonNum("valor")
	cNaturEsp  := Self:JsonText("natureza")
	dVenctoEsp := Self:ParseDate(Self:JsonText("vencimento"))

	If Empty(cParcela)
		cParcela := "1"
	EndIf
	If Empty(cNumero)
		Self:RespErro("Campo 'numero' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cTipo)
		Self:RespErro("Campo 'tipo' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cFornece)
		Self:RespErro("Campo 'fornecedor' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cLoja)
		cLoja := "01"
	EndIf
	If !Self:PreparaAmbiente(@cFilAux, @cFilOrig)
		Return .F.
	EndIf

	cFilSE := PadR(cFilAux, Self:TamCampo("E2_FILIAL", 2))

	Begin Sequence
		If !Self:PosicionaPagar(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
			Self:RestauraAmbiente()
			Self:RespErro("Titulo a pagar nao encontrado no SE2.")
			Return .F.
		EndIf

		If Self:PagarComMovimento()
			Self:RestauraAmbiente()
			Self:RespErro("Titulo possui movimentacao e nao pode ser estornado.")
			Return .F.
		EndIf

		If Self:PagarFoiAlterado(nValorEsp, cNaturEsp, dVenctoEsp)
			Self:RestauraAmbiente()
			Self:RespErro("Titulo foi alterado no Protheus e nao pode ser estornado.")
			Return .F.
		EndIf

		nValor := SE2->E2_VALOR

		For nCopia := 1 To 4
			If !Self:PosicionaPagar(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
				Exit
			EndIf
			If Self:PagarComMovimento()
				lErro := .T.
				Self:RespErro("Titulo possui movimentacao e nao pode ser estornado.")
				Exit
			EndIf
			If Self:PagarFoiAlterado(nValorEsp, cNaturEsp, dVenctoEsp)
				lErro := .T.
				Self:RespErro("Titulo foi alterado no Protheus e nao pode ser estornado.")
				Exit
			EndIf
			If !Self:ApagaSE2Aberto()
				lErro := .T.
				Self:RespErro("Nao foi possivel excluir o titulo no SE2.")
				Exit
			EndIf
		Next

		If !lErro .And. Self:PosicionaPagar(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
			Self:RespErro("Titulo permanece ativo no SE2 apos o estorno.")
		ElseIf !lErro
			Self:RespOk("extornar-pagar", cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja, nValor, cFilSE)
		EndIf
	Recover
		Self:RespErro("Falha ao estornar o titulo no SE2. Compile FinRestTitulos e reinicie o job HTTP REST.")
	End Sequence

	Self:RestauraAmbiente()

Return Self:lSuccess

/*/{Protheus.doc} IsoDate
Converte data Protheus para YYYY-MM-DD.
/*/
Method IsoDate(dData) Class FinRestTitulosSvc

	Local cS := "" As Character

	If Empty(dData) .Or. ValType(dData) <> "D"
		Return ""
	EndIf

	cS := DToS(dData)
	If Empty(cS)
		Return ""
	EndIf

Return SubStr(cS, 1, 4) + "-" + SubStr(cS, 5, 2) + "-" + SubStr(cS, 7, 2)

/*/{Protheus.doc} ConsultarPagar
Le saldo, baixa e situacao do titulo no SE2. Nao grava nada.
/*/
Method ConsultarPagar() Class FinRestTitulosSvc

	Local oResp    As Object
	Local cFilAux  := "" As Character
	Local cPrefixo := "" As Character
	Local cNumero  := "" As Character
	Local cParcela := "" As Character
	Local cTipo    := "" As Character
	Local cFornece := "" As Character
	Local cLoja    := "" As Character
	Local cFilOrig := "" As Character
	Local cFilSE   := "" As Character
	Local cSit     := "" As Character
	Local cHist    := "" As Character
	Local cNatur   := "" As Character
	Local nValor   := 0 As Numeric
	Local nSaldo   := 0 As Numeric

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cFilAux  := Self:JsonText("filial")
	cPrefixo := Self:JsonText("prefixo")
	cNumero  := Self:JsonText("numero")
	cParcela := Self:JsonText("parcela")
	cTipo    := Self:JsonText("tipo")
	cFornece := Self:JsonText("fornecedor")
	cLoja    := Self:JsonText("loja")
	cFilOrig := Self:JsonText("filOrig")

	If Empty(cParcela)
		cParcela := "1"
	EndIf
	If Empty(cNumero)
		Self:RespErro("Campo 'numero' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cTipo)
		Self:RespErro("Campo 'tipo' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cFornece)
		Self:RespErro("Campo 'fornecedor' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cLoja)
		cLoja := "01"
	EndIf
	If !Self:PreparaAmbiente(@cFilAux, @cFilOrig)
		Return .F.
	EndIf

	cFilSE := PadR(cFilAux, Self:TamCampo("E2_FILIAL", 2))
	oResp := JsonObject():New()

	Begin Sequence
		If !Self:PosicionaPagar(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cFornece, cLoja)
			oResp["code"]       := "200"
			oResp["message"]    := "Titulo nao encontrado no SE2"
			oResp["encontrado"] := 0
			oResp["situacao"]   := "nao_encontrado"
			oResp["prefixo"]    := AllTrim(cPrefixo)
			oResp["numero"]     := AllTrim(cNumero)
			oResp["parcela"]    := AllTrim(cParcela)
			oResp["tipo"]       := AllTrim(cTipo)
			oResp["fornecedor"] := AllTrim(cFornece)
			oResp["loja"]       := AllTrim(cLoja)
			Self:lSuccess  := .T.
			Self:cJsonRet  := oResp:ToJson()
			Self:cError    := ""
			Self:cErrorMsg := ""
		Else
			nValor := SE2->E2_VALOR
			nSaldo := SE2->E2_SALDO
			If nSaldo <= 0
				cSit := "baixado"
			ElseIf nSaldo < nValor .Or. !Empty(SE2->E2_BAIXA)
				cSit := "parcial"
			Else
				cSit := "aberto"
			EndIf

			If SE2->(FieldPos("E2_HIST")) > 0
				cHist := AllTrim(SE2->E2_HIST)
			EndIf
			If SE2->(FieldPos("E2_NATUREZ")) > 0
				cNatur := AllTrim(SE2->E2_NATUREZ)
			EndIf

			oResp["code"]       := "200"
			oResp["message"]    := "Titulo localizado no SE2"
			oResp["encontrado"] := 1
			oResp["situacao"]   := cSit
			oResp["filial"]     := AllTrim(SE2->E2_FILIAL)
			If SE2->(FieldPos("E2_FILORIG")) > 0
				oResp["filOrig"] := AllTrim(SE2->E2_FILORIG)
			Else
				oResp["filOrig"] := AllTrim(cFilOrig)
			EndIf
			oResp["prefixo"]    := AllTrim(SE2->E2_PREFIXO)
			oResp["numero"]     := AllTrim(SE2->E2_NUM)
			oResp["parcela"]    := AllTrim(SE2->E2_PARCELA)
			oResp["tipo"]       := AllTrim(SE2->E2_TIPO)
			oResp["fornecedor"] := AllTrim(SE2->E2_FORNECE)
			oResp["loja"]       := AllTrim(SE2->E2_LOJA)
			oResp["natureza"]   := cNatur
			oResp["historico"]  := cHist
			oResp["valor"]      := nValor
			oResp["saldo"]      := nSaldo
			oResp["emissao"]    := Self:IsoDate(SE2->E2_EMISSAO)
			oResp["vencimento"] := Self:IsoDate(SE2->E2_VENCTO)
			oResp["baixa"]      := Self:IsoDate(SE2->E2_BAIXA)

			Self:lSuccess  := .T.
			Self:cJsonRet  := oResp:ToJson()
			Self:cError    := ""
			Self:cErrorMsg := ""
		EndIf
	Recover
		Self:RespErro("Falha ao consultar o titulo no SE2.")
	End Sequence

	Self:RestauraAmbiente()

Return Self:lSuccess

/*/{Protheus.doc} FornecedorBloqueado
A2_MSBLQL 1 ou S = bloqueado. 2 ou vazio = ativo.
/*/
Method FornecedorBloqueado() Class FinRestTitulosSvc

	Local cBlq := "" As Character

	If SA2->(FieldPos("A2_MSBLQL")) > 0
		cBlq := AllTrim(Upper(SA2->A2_MSBLQL))
		If cBlq == "1" .Or. cBlq == "S"
			Return .T.
		EndIf
	EndIf

Return .F.

/*/{Protheus.doc} AddFornecedorItem
Acrescenta o SA2 posicionado na lista JSON, sem duplicar.
/*/
Method AddFornecedorItem(aJson, aSeen, nMax) Class FinRestTitulosSvc

	Local oItem As Object
	Local cId   := "" As Character
	Local cNome := "" As Character
	Local cCgc  := "" As Character

	Default nMax := 40

	If Len(aJson) >= nMax
		Return .F.
	EndIf
	If Self:FornecedorBloqueado()
		Return .F.
	EndIf

	cId := PadR(SA2->A2_COD, 6) + PadR(SA2->A2_LOJA, 2)
	If AScan(aSeen, cId) > 0
		Return .F.
	EndIf

	cNome := AllTrim(SA2->A2_NREDUZ)
	If Empty(cNome)
		cNome := AllTrim(SA2->A2_NOME)
	EndIf
	If SA2->(FieldPos("A2_CGC")) > 0
		cCgc := AllTrim(SA2->A2_CGC)
	EndIf

	AAdd(aSeen, cId)
	oItem := JsonObject():New()
	oItem["codigo"] := AllTrim(SA2->A2_COD)
	oItem["loja"]   := AllTrim(SA2->A2_LOJA)
	oItem["nome"]   := cNome
	oItem["razao"]  := AllTrim(SA2->A2_NOME)
	oItem["cnpj"]   := cCgc
	AAdd(aJson, oItem:ToJson())
	FwFreeObj(oItem)

Return .T.

/*/{Protheus.doc} VarreSA2
Seek suave no indice e coleta ate nMax, filtrando a busca.
cCampo: COD, CGC, NREDUZ ou NOME.
/*/
Method VarreSA2(nOrder, cFilPad, cPrefix, cCampo, cBusca, cDig, aJson, aSeen, nMax) Class FinRestTitulosSvc

	Local nScan  := 0 As Numeric
	Local nLim   := 400 As Numeric
	Local cValor := "" As Character
	Local cNorm  := "" As Character
	Local cCmp   := "" As Character
	Local lOk    := .F. As Logical

	Default nOrder  := 0
	Default cFilPad := ""
	Default cPrefix := ""
	Default cCampo  := "NREDUZ"
	Default cBusca  := ""
	Default cDig    := ""
	Default nMax    := 40

	If nOrder <= 0 .Or. Empty(cPrefix) .Or. Len(aJson) >= nMax
		Return .F.
	EndIf

	cNorm := Upper(StrTran(AllTrim(cBusca), " ", ""))
	SA2->(DbSetOrder(nOrder))
	If !SA2->(DbSeek(cFilPad + cPrefix, .T.))
		Return .F.
	EndIf

	While !SA2->(Eof()) .And. nScan < nLim .And. Len(aJson) < nMax
		nScan++
		If SA2->A2_FILIAL <> cFilPad
			Exit
		EndIf

		If cCampo == "COD"
			cValor := AllTrim(SA2->A2_COD)
		ElseIf cCampo == "CGC"
			If SA2->(FieldPos("A2_CGC")) > 0
				cValor := AllTrim(SA2->A2_CGC)
			EndIf
		ElseIf cCampo == "NOME"
			cValor := AllTrim(SA2->A2_NOME)
		Else
			cValor := AllTrim(SA2->A2_NREDUZ)
		EndIf

		If cCampo == "COD"
			If PadL(cValor, 6, "0") <> PadL(AllTrim(cPrefix), 6, "0") .And. Upper(Left(cValor, Len(AllTrim(cPrefix)))) <> Upper(AllTrim(cPrefix))
				Exit
			EndIf
		ElseIf cCampo == "CGC"
			If !(cPrefix $ StrTran(cValor, " ", ""))
				Exit
			EndIf
		ElseIf Upper(Left(cValor, Len(cPrefix))) <> Upper(cPrefix)
			Exit
		EndIf

		cCmp := Upper(StrTran(cValor, " ", ""))
		lOk  := Empty(cNorm)
		If !lOk
			If cNorm $ cCmp .Or. cNorm $ Upper(StrTran(AllTrim(SA2->A2_NREDUZ), " ", "")) .Or. cNorm $ Upper(StrTran(AllTrim(SA2->A2_NOME), " ", "")) .Or. cNorm $ AllTrim(SA2->A2_COD)
				lOk := .T.
			ElseIf !Empty(cDig) .And. SA2->(FieldPos("A2_CGC")) > 0 .And. cDig $ AllTrim(SA2->A2_CGC)
				lOk := .T.
			EndIf
		EndIf
		If lOk
			Self:AddFornecedorItem(@aJson, @aSeen, nMax)
		EndIf
		SA2->(DbSkip())
	EndDo

Return Len(aJson) > 0

/*/{Protheus.doc} ConsultarFornecedores
Busca indexada no SA2. Nao pagina a tabela e nao troca empresa/filial do job.
/*/
Method ConsultarFornecedores() Class FinRestTitulosSvc

	Local aArea    As Array
	Local aJson    := {} As Array
	Local aSeen    := {} As Array
	Local nMax     := 40 As Numeric
	Local nOrdRed  := 0 As Numeric
	Local nOrdNom  := 0 As Numeric
	Local nOrdCgc  := 0 As Numeric
	Local nTamFil  := 2 As Numeric
	Local cBusca   := "" As Character
	Local cDig     := "" As Character
	Local cPref    := "" As Character
	Local cPref2   := "" As Character
	Local cFilPad  := "" As Character
	Local cJson    := "" As Character
	Local nI       := 0 As Numeric
	Local cMsg     := "" As Character

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cBusca := Self:JsonText("busca")
	If Empty(cBusca)
		cBusca := Self:JsonText("search")
	EndIf
	If Empty(cBusca)
		cBusca := Self:JsonText("nome")
	EndIf
	If Empty(cBusca)
		cBusca := Self:JsonText("codigo")
	EndIf
	cBusca := AllTrim(cBusca)

	nMax := Self:JsonNum("limit")
	If nMax < 1
		nMax := 40
	ElseIf nMax > 80
		nMax := 80
	EndIf

	If Len(cBusca) < 2
		Self:lSuccess  := .T.
		Self:cJsonRet  := '{"code":"200","message":"Informe ao menos 2 caracteres","items":[],"total":0}'
		Self:cError    := ""
		Self:cErrorMsg := ""
		Return .T.
	EndIf

	cDig := ""
	For nI := 1 To Len(cBusca)
		If SubStr(cBusca, nI, 1) $ "0123456789"
			cDig += SubStr(cBusca, nI, 1)
		EndIf
	Next

	aArea   := GetArea()
	DbSelectArea("SA2")
	nTamFil := Len(SA2->A2_FILIAL)
	If nTamFil < 1
		nTamFil := Self:TamCampo("A2_FILIAL", 4)
	EndIf
	cFilPad := xFilial("SA2")
	cFilPad := PadR(cFilPad, nTamFil)
	nOrdRed := RetOrdem("SA2", "A2_FILIAL+A2_NREDUZ")
	nOrdNom := RetOrdem("SA2", "A2_FILIAL+A2_NOME")
	nOrdCgc := RetOrdem("SA2", "A2_FILIAL+A2_CGC")
	If nOrdRed <= 0
		nOrdRed := 3
	EndIf
	If nOrdNom <= 0
		nOrdNom := 4
	EndIf
	If nOrdCgc <= 0
		nOrdCgc := 5
	EndIf

	If Len(cDig) >= 8
		Self:VarreSA2(nOrdCgc, cFilPad, cDig, "CGC", cBusca, cDig, @aJson, @aSeen, nMax)
	EndIf

	If Len(aJson) < nMax .And. !Empty(cDig) .And. Len(cDig) <= 6 .And. cDig == StrTran(cBusca, " ", "")
		Self:VarreSA2(1, cFilPad, PadL(cDig, Self:TamCampo("A2_COD", 6), "0"), "COD", cBusca, cDig, @aJson, @aSeen, nMax)
		If Len(aJson) == 0
			Self:VarreSA2(1, cFilPad, cDig, "COD", cBusca, cDig, @aJson, @aSeen, nMax)
		EndIf
	EndIf

	If Len(aJson) < nMax
		cPref  := Upper(Left(StrTran(cBusca, " ", ""), 2))
		cPref2 := Upper(Left(cBusca, 2))
		Self:VarreSA2(nOrdRed, cFilPad, cPref, "NREDUZ", cBusca, cDig, @aJson, @aSeen, nMax)
		If Len(aJson) < nMax
			Self:VarreSA2(nOrdNom, cFilPad, cPref, "NOME", cBusca, cDig, @aJson, @aSeen, nMax)
		EndIf
		If Len(aJson) < nMax .And. cPref2 <> cPref
			Self:VarreSA2(nOrdRed, cFilPad, cPref2, "NREDUZ", cBusca, cDig, @aJson, @aSeen, nMax)
			If Len(aJson) < nMax
				Self:VarreSA2(nOrdNom, cFilPad, cPref2, "NOME", cBusca, cDig, @aJson, @aSeen, nMax)
			EndIf
		EndIf
	EndIf

	RestArea(aArea)

	If Len(aJson) == 0
		cMsg := "Nenhum fornecedor ativo encontrado"
	Else
		cMsg := "Consulta SA2 por indice"
	EndIf

	cJson := '{"code":"200","message":"' + cMsg + '","origem":"indice","items":['
	For nI := 1 To Len(aJson)
		If nI > 1
			cJson += ","
		EndIf
		cJson += aJson[nI]
	Next
	cJson += '],"total":' + cValToChar(Len(aJson))
	If Len(aJson) >= nMax
		cJson += ',"truncated":true'
	Else
		cJson += ',"truncated":false'
	EndIf
	cJson += '}'

	Self:lSuccess  := .T.
	Self:cJsonRet  := cJson
	Self:cError    := ""
	Self:cErrorMsg := ""

Return .T.

/*/{Protheus.doc} ConsultarTipos
Lista SX5 tabela 05 (tipos de titulo). Ignora deletados. Sem troca de empresa.
/*/
Method ConsultarTipos() Class FinRestTitulosSvc

	Local aArea   As Array
	Local aJson   := {} As Array
	Local nMax    := 80 As Numeric
	Local nTamFil := 2 As Numeric
	Local nScan   := 0 As Numeric
	Local cBusca  := "" As Character
	Local cFilPad := "" As Character
	Local cTab    := "05" As Character
	Local cChave  := "" As Character
	Local cDesc   := "" As Character
	Local cJson   := "" As Character
	Local oItem   As Object
	Local nI      := 0 As Numeric
	Local lOk     := .F. As Logical

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cBusca := Self:JsonText("busca")
	If Empty(cBusca)
		cBusca := Self:JsonText("search")
	EndIf
	cBusca := Upper(AllTrim(cBusca))

	nMax := Self:JsonNum("limit")
	If nMax < 1
		nMax := 80
	ElseIf nMax > 200
		nMax := 200
	EndIf

	aArea   := GetArea()
	nTamFil := Self:TamCampo("X5_FILIAL", 2)
	cFilPad := PadR(xFilial("SX5"), nTamFil)

	DbSelectArea("SX5")
	SX5->(DbSetOrder(1))
	If !SX5->(DbSeek(cFilPad + cTab))
		cFilPad := Space(nTamFil)
		SX5->(DbSeek(cFilPad + cTab))
	EndIf

	While !SX5->(Eof()) .And. nScan < 300 .And. Len(aJson) < nMax
		nScan++
		If SX5->X5_FILIAL <> cFilPad .Or. SX5->X5_TABELA <> cTab
			Exit
		EndIf
		cChave := AllTrim(SX5->X5_CHAVE)
		If SX5->(FieldPos("X5_DESCRI")) > 0
			cDesc := AllTrim(SX5->X5_DESCRI)
		Else
			cDesc := cChave
		EndIf
		lOk := Empty(cBusca) .Or. cBusca $ Upper(cChave) .Or. cBusca $ Upper(cDesc)
		If lOk .And. !Empty(cChave) .And. Len(cChave) <= 3
			oItem := JsonObject():New()
			oItem["tabela"]    := cTab
			oItem["codigo"]    := cChave
			oItem["descricao"] := cDesc
			AAdd(aJson, oItem:ToJson())
			FwFreeObj(oItem)
		EndIf
		SX5->(DbSkip())
	EndDo

	RestArea(aArea)

	cJson := '{"code":"200","message":"Consulta SX5 tabela 05","origem":"indice","items":['
	For nI := 1 To Len(aJson)
		If nI > 1
			cJson += ","
		EndIf
		cJson += aJson[nI]
	Next
	cJson += '],"total":' + cValToChar(Len(aJson)) + ',"truncated":false}'

	Self:lSuccess  := .T.
	Self:cJsonRet  := cJson
	Self:cError    := ""
	Self:cErrorMsg := ""

Return .T.

/*/{Protheus.doc} CorrigeE1
Garante E1_FILIAL do JSON. O FINA040 grava a filial da sessao HTTP (01).
Corrige para a filial do titulo (M0_CODIGO, ex. 03) se nao houver movimento.
So retorna .T. se o SE1 posicionado tiver E1_FILIAL igual ao pedido.
/*/
Method CorrigeE1(cFilWant, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja) Class FinRestTitulosSvc

	Local cWant := "" As Character
	Local cSuf  := "" As Character
	Local nTam  := 2 As Numeric
	Local nRec  := 0 As Numeric
	Local lOk   := .F. As Logical
	Local lLock := .F. As Logical

	Default cFilWant := ""
	Default cFilOrig := ""
	Default cPrefixo := ""
	Default cNumero  := ""
	Default cParcela := ""
	Default cTipo    := ""
	Default cCliente := ""
	Default cLoja    := ""

	If !Self:PosicionaReceber(cFilWant, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
		Return .F.
	EndIf

	nTam := Self:TamCampo("E1_FILIAL", 2)
	cWant := PadR(AllTrim(cFilWant), nTam)
	cSuf := PadR(cPrefixo, Self:TamCampo("E1_PREFIXO", 3))
	cSuf += PadR(cNumero, Self:TamCampo("E1_NUM", 9))
	cSuf += PadR(cParcela, Self:TamCampo("E1_PARCELA", 2))
	cSuf += PadR(cTipo, Self:TamCampo("E1_TIPO", 3))

	If AllTrim(SE1->E1_FILIAL) == AllTrim(cWant)
		If SE1->(FieldPos("E1_FILORIG")) > 0 .And. !Empty(cFilOrig) .And. AllTrim(SE1->E1_FILORIG) <> AllTrim(cFilOrig)
			Begin Sequence
				If RecLock("SE1", .F.)
					Replace E1_FILORIG With PadR(cFilOrig, Self:TamCampo("E1_FILORIG", 4))
					SE1->(MsUnlock())
					SE1->(DbCommit())
				EndIf
			Recover
				SE1->(MsUnlock())
			End Sequence
		EndIf
		Return .T.
	EndIf

	If Self:TemBaixaE1()
		Return .F.
	EndIf

	nRec := SE1->(Recno())
	Begin Sequence
		If RecLock("SE1", .F.)
			Replace E1_FILIAL With cWant
			If SE1->(FieldPos("E1_FILORIG")) > 0 .And. !Empty(cFilOrig)
				Replace E1_FILORIG With PadR(cFilOrig, Self:TamCampo("E1_FILORIG", 4))
			EndIf
			SE1->(MsUnlock())
			SE1->(DbCommit())
			lLock := .T.
		EndIf
	Recover
		lLock := .F.
		SE1->(MsUnlock())
	End Sequence

	If !lLock
		Return .F.
	EndIf

	Begin Sequence
		DbSelectArea("SE1")
		SE1->(DbSetOrder(1))
		If SE1->(DbSeek(cWant + cSuf))
			lOk := AllTrim(SE1->E1_FILIAL) == AllTrim(cWant)
		ElseIf nRec > 0
			SE1->(DbGoTo(nRec))
			lOk := AllTrim(SE1->E1_FILIAL) == AllTrim(cWant)
		EndIf
	Recover
		lOk := .F.
	End Sequence

Return lOk

/*/{Protheus.doc} PosicionaReceber
Localiza SE1 pela chave (filial+prefixo+num+parcela+tipo).
Tenta a filial do JSON, 03, 01 e o sufixo de filOrig.
Confere cliente/loja quando informados. Nao usa SetDeleted.
/*/
Method PosicionaReceber(cFilWant, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja) Class FinRestTitulosSvc

	Local aFils := {} As Array
	Local cSuf  := "" As Character
	Local cTry  := "" As Character
	Local nI    := 0 As Numeric
	Local nTam  := 2 As Numeric
	Local lOk   := .F. As Logical

	Default cFilWant := ""
	Default cFilOrig := ""
	Default cPrefixo := ""
	Default cNumero  := ""
	Default cParcela := ""
	Default cTipo    := ""
	Default cCliente := ""
	Default cLoja    := ""

	nTam := Self:TamCampo("E1_FILIAL", 2)
	cSuf := PadR(cPrefixo, Self:TamCampo("E1_PREFIXO", 3))
	cSuf += PadR(cNumero, Self:TamCampo("E1_NUM", 9))
	cSuf += PadR(cParcela, Self:TamCampo("E1_PARCELA", 2))
	cSuf += PadR(cTipo, Self:TamCampo("E1_TIPO", 3))

	AAdd(aFils, PadR(AllTrim(cFilWant), nTam))
	If Type("cFilAnt") == "C" .And. !Empty(AllTrim(cFilAnt))
		AAdd(aFils, PadR(AllTrim(cFilAnt), nTam))
	EndIf
	AAdd(aFils, PadR("03", nTam))
	AAdd(aFils, PadR("01", nTam))
	If Len(AllTrim(cFilOrig)) >= 2
		AAdd(aFils, PadR(Right(AllTrim(cFilOrig), 2), nTam))
	EndIf

	Begin Sequence
		DbSelectArea("SE1")
		SE1->(DbSetOrder(1))
	Recover
		Return .F.
	End Sequence

	For nI := 1 To Len(aFils)
		cTry := aFils[nI]
		If Empty(AllTrim(cTry))
			Loop
		EndIf
		If nI > 1 .And. AScan(aFils, cTry) < nI
			Loop
		EndIf
		Begin Sequence
			If SE1->(DbSeek(cTry + cSuf))
				lOk := .T.
				If !Empty(cCliente) .And. AllTrim(SE1->E1_CLIENTE) <> AllTrim(cCliente)
					lOk := .F.
				EndIf
				If lOk .And. !Empty(cLoja) .And. AllTrim(SE1->E1_LOJA) <> AllTrim(cLoja)
					lOk := .F.
				EndIf
			EndIf
		Recover
			lOk := .F.
		End Sequence
		If lOk
			nI := Len(aFils)
		EndIf
	Next

Return lOk

/*/{Protheus.doc} ReceberComMovimento
Titulo com baixa, bordero, valor liquidado ou movimento no SE5 nao pode ser estornado.
E1_LA e E1_MOVIMEN da inclusao FINA040 nao sao baixa.
/*/
Method ReceberComMovimento() Class FinRestTitulosSvc

Return Self:TemBaixaE1()

/*/{Protheus.doc} TemBaixaE1
Baixa real no SE1 (saldo, data de baixa, SE5). Ignora E1_LA da inclusao FINA040.
/*/
Method TemBaixaE1() Class FinRestTitulosSvc

	If Abs(SE1->E1_SALDO - SE1->E1_VALOR) > 0.009
		Return .T.
	EndIf
	If !Empty(SE1->E1_BAIXA)
		Return .T.
	EndIf
	If SE1->(FieldPos("E1_VALLIQ")) > 0 .And. SE1->E1_VALLIQ > 0
		Return .T.
	EndIf
	If SE1->(FieldPos("E1_NUMBOR")) > 0 .And. !Empty(AllTrim(SE1->E1_NUMBOR))
		Return .T.
	EndIf
	If SE1->(FieldPos("E1_IDCNAB")) > 0 .And. !Empty(AllTrim(SE1->E1_IDCNAB))
		Return .T.
	EndIf
	If SE1->(FieldPos("E1_FATURA")) > 0 .And. !Empty(AllTrim(SE1->E1_FATURA))
		Return .T.
	EndIf
	If Self:TemMovSE1()
		Return .T.
	EndIf

Return .F.

/*/{Protheus.doc} TemMovSE1
Titulo a receber com movimento no SE5 nao pode ser estornado.
/*/
Method TemMovSE1() Class FinRestTitulosSvc

	Local aArea  As Array
	Local cChave := "" As Character
	Local lMov   := .F. As Logical

	aArea := GetArea()
	DbSelectArea("SE5")
	Begin Sequence
		SE5->(DbSetOrder(7))
		cChave := PadR(SE1->E1_FILIAL, Self:TamCampo("E5_FILIAL", 2))
		cChave += PadR(SE1->E1_PREFIXO, Self:TamCampo("E5_PREFIXO", 3))
		cChave += PadR(SE1->E1_NUM, Self:TamCampo("E5_NUMERO", 9))
		cChave += PadR(SE1->E1_PARCELA, Self:TamCampo("E5_PARCELA", 2))
		cChave += PadR(SE1->E1_TIPO, Self:TamCampo("E5_TIPO", 3))
		cChave += PadR(SE1->E1_CLIENTE, Self:TamCampo("E5_CLIFOR", 6))
		cChave += PadR(SE1->E1_LOJA, Self:TamCampo("E5_LOJA", 2))
		If SE5->(DbSeek(cChave))
			lMov := .T.
		EndIf
	Recover
		lMov := .F.
	End Sequence
	RestArea(aArea)

Return lMov

/*/{Protheus.doc} ReceberFoiAlterado
Compara o SE1 com o payload do FinCalc.
/*/
Method ReceberFoiAlterado(nValor, cNatureza, dVencto) Class FinRestTitulosSvc

	Default nValor    := 0
	Default cNatureza := ""
	Default dVencto   := CToD("")

	If nValor > 0 .And. Abs(SE1->E1_VALOR - nValor) > 0.009
		Return .T.
	EndIf
	If !Empty(AllTrim(cNatureza)) .And. SE1->(FieldPos("E1_NATUREZ")) > 0
		If AllTrim(SE1->E1_NATUREZ) <> AllTrim(cNatureza)
			Return .T.
		EndIf
	EndIf
	If !Empty(dVencto) .And. SE1->E1_VENCTO <> dVencto
		Return .T.
	EndIf

Return .F.

/*/{Protheus.doc} ApagaSE1Aberto
Estorna o SE1 posicionado com DbDelete(). Nao acessar D_E_L_E_T_.
/*/
Method ApagaSE1Aberto() Class FinRestTitulosSvc

	Local lOk := .F. As Logical

	If Self:TemBaixaE1()
		Return .F.
	EndIf

	Begin Sequence
		If RecLock("SE1", .F.)
			SE1->(DbDelete())
			SE1->(MsUnlock())
			SE1->(DbCommit())
			lOk := .T.
		EndIf
	Recover
		lOk := .F.
		SE1->(MsUnlock())
	End Sequence

Return lOk

/*/{Protheus.doc} ExcluirReceber
Estorna titulo a receber sem movimentacao nem alteracao.
/*/
Method ExcluirReceber() Class FinRestTitulosSvc

	Local cFilAux    := "" As Character
	Local cPrefixo   := "" As Character
	Local cNumero    := "" As Character
	Local cParcela   := "" As Character
	Local cTipo      := "" As Character
	Local cCliente   := "" As Character
	Local cLoja      := "" As Character
	Local cFilOrig   := "" As Character
	Local cFilSE     := "" As Character
	Local nValor     := 0 As Numeric
	Local nValorEsp  := 0 As Numeric
	Local cNaturEsp  := "" As Character
	Local dVenctoEsp := CToD("") As Date
	Local lErro      := .F. As Logical
	Local nCopia     := 0 As Numeric

	Private lMsErroAuto := .F.
	Private lMsHelpAuto := .T.
	Private lAutoErrNoFile := .T.

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cFilAux    := Self:JsonText("filial")
	cPrefixo   := Self:JsonText("prefixo")
	cNumero    := Self:JsonText("numero")
	cParcela   := Self:JsonText("parcela")
	cTipo      := Self:JsonText("tipo")
	cCliente   := Self:JsonText("cliente")
	cLoja      := Self:JsonText("loja")
	cFilOrig   := Self:JsonText("filOrig")
	nValorEsp  := Self:JsonNum("valor")
	cNaturEsp  := Self:JsonText("natureza")
	dVenctoEsp := Self:ParseDate(Self:JsonText("vencimento"))

	If Empty(cParcela)
		cParcela := "1"
	EndIf
	If Empty(cNumero)
		Self:RespErro("Campo 'numero' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cTipo)
		Self:RespErro("Campo 'tipo' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cCliente)
		Self:RespErro("Campo 'cliente' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cLoja)
		cLoja := "01"
	EndIf
	If !Self:PreparaAmbiente(@cFilAux, @cFilOrig)
		Return .F.
	EndIf

	cFilSE := PadR(cFilAux, Self:TamCampo("E1_FILIAL", 2))

	Begin Sequence
		If !Self:PosicionaReceber(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
			Self:RestauraAmbiente()
			Self:RespErro("Titulo a receber nao encontrado no SE1.")
			Return .F.
		EndIf

		If Self:ReceberComMovimento()
			Self:RestauraAmbiente()
			Self:RespErro("Titulo possui movimentacao e nao pode ser estornado.")
			Return .F.
		EndIf

		If Self:ReceberFoiAlterado(nValorEsp, cNaturEsp, dVenctoEsp)
			Self:RestauraAmbiente()
			Self:RespErro("Titulo foi alterado no Protheus e nao pode ser estornado.")
			Return .F.
		EndIf

		nValor := SE1->E1_VALOR

		For nCopia := 1 To 4
			If !Self:PosicionaReceber(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
				Exit
			EndIf
			If Self:ReceberComMovimento()
				lErro := .T.
				Self:RespErro("Titulo possui movimentacao e nao pode ser estornado.")
				Exit
			EndIf
			If Self:ReceberFoiAlterado(nValorEsp, cNaturEsp, dVenctoEsp)
				lErro := .T.
				Self:RespErro("Titulo foi alterado no Protheus e nao pode ser estornado.")
				Exit
			EndIf
			If !Self:ApagaSE1Aberto()
				lErro := .T.
				Self:RespErro("Nao foi possivel excluir o titulo no SE1.")
				Exit
			EndIf
		Next

		If !lErro .And. Self:PosicionaReceber(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
			Self:RespErro("Titulo permanece ativo no SE1 apos o estorno.")
		ElseIf !lErro
			Self:RespOk("extornar-receber", cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja, nValor, cFilSE)
		EndIf
	Recover
		Self:RespErro("Falha ao estornar o titulo no SE1. Compile FinRestTitulos e reinicie o job HTTP REST.")
	End Sequence

	Self:RestauraAmbiente()

Return Self:lSuccess

/*/{Protheus.doc} ConsultarReceber
Le saldo, baixa e situacao do titulo no SE1. Nao grava nada.
/*/
Method ConsultarReceber() Class FinRestTitulosSvc

	Local oResp    As Object
	Local cFilAux  := "" As Character
	Local cPrefixo := "" As Character
	Local cNumero  := "" As Character
	Local cParcela := "" As Character
	Local cTipo    := "" As Character
	Local cCliente := "" As Character
	Local cLoja    := "" As Character
	Local cFilOrig := "" As Character
	Local cFilSE   := "" As Character
	Local cSit     := "" As Character
	Local cHist    := "" As Character
	Local cNatur   := "" As Character
	Local nValor   := 0 As Numeric
	Local nSaldo   := 0 As Numeric

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cFilAux  := Self:JsonText("filial")
	cPrefixo := Self:JsonText("prefixo")
	cNumero  := Self:JsonText("numero")
	cParcela := Self:JsonText("parcela")
	cTipo    := Self:JsonText("tipo")
	cCliente := Self:JsonText("cliente")
	cLoja    := Self:JsonText("loja")
	cFilOrig := Self:JsonText("filOrig")

	If Empty(cParcela)
		cParcela := "1"
	EndIf
	If Empty(cNumero)
		Self:RespErro("Campo 'numero' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cTipo)
		Self:RespErro("Campo 'tipo' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cCliente)
		Self:RespErro("Campo 'cliente' e obrigatorio.")
		Return .F.
	EndIf
	If Empty(cLoja)
		cLoja := "01"
	EndIf
	If !Self:PreparaAmbiente(@cFilAux, @cFilOrig)
		Return .F.
	EndIf

	cFilSE := PadR(cFilAux, Self:TamCampo("E1_FILIAL", 2))
	oResp := JsonObject():New()

	Begin Sequence
		If !Self:PosicionaReceber(cFilSE, cFilOrig, cPrefixo, cNumero, cParcela, cTipo, cCliente, cLoja)
			oResp["code"]       := "200"
			oResp["message"]    := "Titulo nao encontrado no SE1"
			oResp["encontrado"] := 0
			oResp["situacao"]   := "nao_encontrado"
			oResp["prefixo"]    := AllTrim(cPrefixo)
			oResp["numero"]     := AllTrim(cNumero)
			oResp["parcela"]    := AllTrim(cParcela)
			oResp["tipo"]       := AllTrim(cTipo)
			oResp["cliente"]    := AllTrim(cCliente)
			oResp["loja"]       := AllTrim(cLoja)
			Self:lSuccess  := .T.
			Self:cJsonRet  := oResp:ToJson()
			Self:cError    := ""
			Self:cErrorMsg := ""
		Else
			nValor := SE1->E1_VALOR
			nSaldo := SE1->E1_SALDO
			If nSaldo <= 0
				cSit := "baixado"
			ElseIf nSaldo < nValor .Or. !Empty(SE1->E1_BAIXA)
				cSit := "parcial"
			Else
				cSit := "aberto"
			EndIf

			If SE1->(FieldPos("E1_HIST")) > 0
				cHist := AllTrim(SE1->E1_HIST)
			EndIf
			If SE1->(FieldPos("E1_NATUREZ")) > 0
				cNatur := AllTrim(SE1->E1_NATUREZ)
			EndIf

			oResp["code"]       := "200"
			oResp["message"]    := "Titulo localizado no SE1"
			oResp["encontrado"] := 1
			oResp["situacao"]   := cSit
			oResp["filial"]     := AllTrim(SE1->E1_FILIAL)
			If SE1->(FieldPos("E1_FILORIG")) > 0
				oResp["filOrig"] := AllTrim(SE1->E1_FILORIG)
			Else
				oResp["filOrig"] := AllTrim(cFilOrig)
			EndIf
			oResp["prefixo"]    := AllTrim(SE1->E1_PREFIXO)
			oResp["numero"]     := AllTrim(SE1->E1_NUM)
			oResp["parcela"]    := AllTrim(SE1->E1_PARCELA)
			oResp["tipo"]       := AllTrim(SE1->E1_TIPO)
			oResp["cliente"]    := AllTrim(SE1->E1_CLIENTE)
			oResp["loja"]       := AllTrim(SE1->E1_LOJA)
			oResp["natureza"]   := cNatur
			oResp["historico"]  := cHist
			oResp["valor"]      := nValor
			oResp["saldo"]      := nSaldo
			oResp["emissao"]    := Self:IsoDate(SE1->E1_EMISSAO)
			oResp["vencimento"] := Self:IsoDate(SE1->E1_VENCTO)
			oResp["baixa"]      := Self:IsoDate(SE1->E1_BAIXA)

			Self:lSuccess  := .T.
			Self:cJsonRet  := oResp:ToJson()
			Self:cError    := ""
			Self:cErrorMsg := ""
		EndIf
	Recover
		Self:RespErro("Falha ao consultar o titulo no SE1.")
	End Sequence

	Self:RestauraAmbiente()

Return Self:lSuccess

/*/{Protheus.doc} ClienteBloqueado
A1_MSBLQL 1 ou S = bloqueado. 2 ou vazio = ativo.
/*/
Method ClienteBloqueado() Class FinRestTitulosSvc

	Local cBlq := "" As Character

	If SA1->(FieldPos("A1_MSBLQL")) > 0
		cBlq := AllTrim(Upper(SA1->A1_MSBLQL))
		If cBlq == "1" .Or. cBlq == "S"
			Return .T.
		EndIf
	EndIf

Return .F.

/*/{Protheus.doc} AddClienteItem
Acrescenta o SA1 posicionado na lista JSON, sem duplicar.
/*/
Method AddClienteItem(aJson, aSeen, nMax) Class FinRestTitulosSvc

	Local oItem As Object
	Local cId   := "" As Character
	Local cNome := "" As Character
	Local cCgc  := "" As Character

	Default nMax := 40

	If Len(aJson) >= nMax
		Return .F.
	EndIf
	If Self:ClienteBloqueado()
		Return .F.
	EndIf

	cId := PadR(SA1->A1_COD, 6) + PadR(SA1->A1_LOJA, 2)
	If AScan(aSeen, cId) > 0
		Return .F.
	EndIf

	cNome := AllTrim(SA1->A1_NREDUZ)
	If Empty(cNome)
		cNome := AllTrim(SA1->A1_NOME)
	EndIf
	If SA1->(FieldPos("A1_CGC")) > 0
		cCgc := AllTrim(SA1->A1_CGC)
	EndIf

	AAdd(aSeen, cId)
	oItem := JsonObject():New()
	oItem["codigo"] := AllTrim(SA1->A1_COD)
	oItem["loja"]   := AllTrim(SA1->A1_LOJA)
	oItem["nome"]   := cNome
	oItem["razao"]  := AllTrim(SA1->A1_NOME)
	oItem["cnpj"]   := cCgc
	AAdd(aJson, oItem:ToJson())
	FwFreeObj(oItem)

Return .T.

/*/{Protheus.doc} VarreSA1
Seek suave no indice SA1 e coleta ate nMax.
/*/
Method VarreSA1(nOrder, cFilPad, cPrefix, cCampo, cBusca, cDig, aJson, aSeen, nMax) Class FinRestTitulosSvc

	Local nScan  := 0 As Numeric
	Local nLim   := 400 As Numeric
	Local cValor := "" As Character
	Local cNorm  := "" As Character
	Local cCmp   := "" As Character
	Local lOk    := .F. As Logical

	Default nOrder  := 0
	Default cFilPad := ""
	Default cPrefix := ""
	Default cCampo  := "NREDUZ"
	Default cBusca  := ""
	Default cDig    := ""
	Default nMax    := 40

	If nOrder <= 0 .Or. Empty(cPrefix) .Or. Len(aJson) >= nMax
		Return .F.
	EndIf

	cNorm := Upper(StrTran(AllTrim(cBusca), " ", ""))
	SA1->(DbSetOrder(nOrder))
	If !SA1->(DbSeek(cFilPad + cPrefix, .T.))
		Return .F.
	EndIf

	While !SA1->(Eof()) .And. nScan < nLim .And. Len(aJson) < nMax
		nScan++
		If SA1->A1_FILIAL <> cFilPad
			Exit
		EndIf

		If cCampo == "COD"
			cValor := AllTrim(SA1->A1_COD)
		ElseIf cCampo == "CGC"
			If SA1->(FieldPos("A1_CGC")) > 0
				cValor := AllTrim(SA1->A1_CGC)
			EndIf
		ElseIf cCampo == "NOME"
			cValor := AllTrim(SA1->A1_NOME)
		Else
			cValor := AllTrim(SA1->A1_NREDUZ)
		EndIf

		If cCampo == "COD"
			If PadL(cValor, 6, "0") <> PadL(AllTrim(cPrefix), 6, "0") .And. Upper(Left(cValor, Len(AllTrim(cPrefix)))) <> Upper(AllTrim(cPrefix))
				Exit
			EndIf
		ElseIf cCampo == "CGC"
			If !(cPrefix $ StrTran(cValor, " ", ""))
				Exit
			EndIf
		ElseIf Upper(Left(cValor, Len(cPrefix))) <> Upper(cPrefix)
			Exit
		EndIf

		cCmp := Upper(StrTran(cValor, " ", ""))
		lOk  := Empty(cNorm)
		If !lOk
			If cNorm $ cCmp .Or. cNorm $ Upper(StrTran(AllTrim(SA1->A1_NREDUZ), " ", "")) .Or. cNorm $ Upper(StrTran(AllTrim(SA1->A1_NOME), " ", "")) .Or. cNorm $ AllTrim(SA1->A1_COD)
				lOk := .T.
			ElseIf !Empty(cDig) .And. SA1->(FieldPos("A1_CGC")) > 0 .And. cDig $ AllTrim(SA1->A1_CGC)
				lOk := .T.
			EndIf
		EndIf
		If lOk
			Self:AddClienteItem(@aJson, @aSeen, nMax)
		EndIf
		SA1->(DbSkip())
	EndDo

Return Len(aJson) > 0

/*/{Protheus.doc} ConsultarClientes
Busca indexada no SA1. Nao pagina a tabela e nao troca empresa/filial do job.
/*/
Method ConsultarClientes() Class FinRestTitulosSvc

	Local aArea    As Array
	Local aJson    := {} As Array
	Local aSeen    := {} As Array
	Local nMax     := 40 As Numeric
	Local nOrdRed  := 0 As Numeric
	Local nOrdNom  := 0 As Numeric
	Local nOrdCgc  := 0 As Numeric
	Local nTamFil  := 2 As Numeric
	Local cBusca   := "" As Character
	Local cDig     := "" As Character
	Local cPref    := "" As Character
	Local cPref2   := "" As Character
	Local cFilPad  := "" As Character
	Local cJson    := "" As Character
	Local nI       := 0 As Numeric
	Local cMsg     := "" As Character

	If !Self:ParsePayload()
		Return .F.
	EndIf

	cBusca := Self:JsonText("busca")
	If Empty(cBusca)
		cBusca := Self:JsonText("search")
	EndIf
	If Empty(cBusca)
		cBusca := Self:JsonText("nome")
	EndIf
	If Empty(cBusca)
		cBusca := Self:JsonText("codigo")
	EndIf
	cBusca := AllTrim(cBusca)

	nMax := Self:JsonNum("limit")
	If nMax < 1
		nMax := 40
	ElseIf nMax > 80
		nMax := 80
	EndIf

	If Len(cBusca) < 2
		Self:lSuccess  := .T.
		Self:cJsonRet  := '{"code":"200","message":"Informe ao menos 2 caracteres","items":[],"total":0}'
		Self:cError    := ""
		Self:cErrorMsg := ""
		Return .T.
	EndIf

	cDig := ""
	For nI := 1 To Len(cBusca)
		If SubStr(cBusca, nI, 1) $ "0123456789"
			cDig += SubStr(cBusca, nI, 1)
		EndIf
	Next

	aArea   := GetArea()
	DbSelectArea("SA1")
	nTamFil := Len(SA1->A1_FILIAL)
	If nTamFil < 1
		nTamFil := Self:TamCampo("A1_FILIAL", 4)
	EndIf
	cFilPad := xFilial("SA1")
	cFilPad := PadR(cFilPad, nTamFil)
	nOrdRed := RetOrdem("SA1", "A1_FILIAL+A1_NREDUZ")
	nOrdNom := RetOrdem("SA1", "A1_FILIAL+A1_NOME")
	nOrdCgc := RetOrdem("SA1", "A1_FILIAL+A1_CGC")
	If nOrdRed <= 0
		nOrdRed := 3
	EndIf
	If nOrdNom <= 0
		nOrdNom := 4
	EndIf
	If nOrdCgc <= 0
		nOrdCgc := 5
	EndIf

	If Len(cDig) >= 8
		Self:VarreSA1(nOrdCgc, cFilPad, cDig, "CGC", cBusca, cDig, @aJson, @aSeen, nMax)
	EndIf

	If Len(aJson) < nMax .And. !Empty(cDig) .And. Len(cDig) <= 6 .And. cDig == StrTran(cBusca, " ", "")
		Self:VarreSA1(1, cFilPad, PadL(cDig, Self:TamCampo("A1_COD", 6), "0"), "COD", cBusca, cDig, @aJson, @aSeen, nMax)
		If Len(aJson) == 0
			Self:VarreSA1(1, cFilPad, cDig, "COD", cBusca, cDig, @aJson, @aSeen, nMax)
		EndIf
	EndIf

	If Len(aJson) < nMax
		cPref  := Upper(Left(StrTran(cBusca, " ", ""), 2))
		cPref2 := Upper(Left(cBusca, 2))
		Self:VarreSA1(nOrdRed, cFilPad, cPref, "NREDUZ", cBusca, cDig, @aJson, @aSeen, nMax)
		If Len(aJson) < nMax
			Self:VarreSA1(nOrdNom, cFilPad, cPref, "NOME", cBusca, cDig, @aJson, @aSeen, nMax)
		EndIf
		If Len(aJson) < nMax .And. cPref2 <> cPref
			Self:VarreSA1(nOrdRed, cFilPad, cPref2, "NREDUZ", cBusca, cDig, @aJson, @aSeen, nMax)
			If Len(aJson) < nMax
				Self:VarreSA1(nOrdNom, cFilPad, cPref2, "NOME", cBusca, cDig, @aJson, @aSeen, nMax)
			EndIf
		EndIf
	EndIf

	RestArea(aArea)

	If Len(aJson) == 0
		cMsg := "Nenhum cliente ativo encontrado"
	Else
		cMsg := "Consulta SA1 por indice"
	EndIf

	cJson := '{"code":"200","message":"' + cMsg + '","origem":"indice","items":['
	For nI := 1 To Len(aJson)
		If nI > 1
			cJson += ","
		EndIf
		cJson += aJson[nI]
	Next
	cJson += '],"total":' + cValToChar(Len(aJson))
	If Len(aJson) >= nMax
		cJson += ',"truncated":true'
	Else
		cJson += ',"truncated":false'
	EndIf
	cJson += '}'

	Self:lSuccess  := .T.
	Self:cJsonRet  := cJson
	Self:cError    := ""
	Self:cErrorMsg := ""

Return .T.
