#include "totvs.ch"
#include "Restful.ch"

/*/{Protheus.doc} PecCodeEstoqueService

    Classe principal do controller com os metodos publicos.

    @author  Otaviano Mattos
    @since   18-10-2021
/*/
WSRESTFUL PecCodeMovEstoque DESCRIPTION "Movimentos e Consultas de Estoque - Pec Code" FORMAT "application/json"

    WSDATA cPayload as character
    WSDATA empresa as character optional
    WSDATA produto as character
    WSDATA filial as character
    WSDATA armazem as character optional

    WSMETHOD GET SALDOPRODUTO DESCRIPTION "API busca saldo dos produtos" ;
        PATH "/PecCodeMovEstoque/saldoProduto" ;
        WSSYNTAX "/PecCodeMovEstoque/saldoProduto/{filial, produto, armazem}" ;
        PRODUCES APPLICATION_JSON

    WSMETHOD POST SAIDAESTOQUE DESCRIPTION "API para baixa de saida de estoque" ;
        PATH "/PecCodeMovEstoque/baixaEstoqueGadoSaida" ;
        WSSYNTAX "/PecCodeMovEstoque/baixaEstoqueGadoSaida" ;
        PRODUCES APPLICATION_JSON

    WSMETHOD POST ESTORNOESTOQUE DESCRIPTION "API para baixa de estorno de estoque" ;
        PATH "/PecCodeMovEstoque/baixaEstoqueGadoEstorno" ;
        WSSYNTAX "/PecCodeMovEstoque/baixaEstoqueGadoEstorno" ;
        PRODUCES APPLICATION_JSON

    WSMETHOD POST ENTRADAESTOQUE DESCRIPTION "API para baixa de entrada de estoque" ;
        PATH "/PecCodeMovEstoque/baixaEstoqueGadoEntrada" ;
        WSSYNTAX "/PecCodeMovEstoque/baixaEstoqueGadoEntrada" ;
        PRODUCES APPLICATION_JSON

    WSMETHOD POST BUSCACUSTOFIXO DESCRIPTION "API para buscar os custos fixos de acordo com o balancete" ;
        PATH "/PecCodeMovEstoque/buscaCustosFixos" ;
        WSSYNTAX "/PecCodeMovEstoque/buscaCustosFixos" ;
        PRODUCES APPLICATION_JSON

END WSRESTFUL

/*/{Protheus.doc} SALDOPRODUTO
    Busca saldo de produtos (SB2).
/*/
WSMETHOD GET SALDOPRODUTO QUERYPARAM empresa, filial, produto, armazem WSSERVICE PecCodeMovEstoque

    Local lRet       As Logical
    Local oPCEstoque As Object

    Default self:empresa := ""
    Default self:produto := ""
    Default self:filial  := ""
    Default self:armazem := ""

    // Padrao FinRest: GetContent antes de SetContentType
    Self:cPayload := ::GetContent()
    Self:SetContentType("application/json")
    oPCEstoque := PecCodeEstoque():New(Self:cPayload, @Self)

    oPCEstoque:buscaSaldoProduto()

    If oPCEstoque:Success()
        lRet := .T.
        Self:SetResponse(EncodeUtf8(oPCEstoque:GetReturn()))
    Else
        lRet := .F.
        SetRestFault(400, EncodeUtf8(oPCEstoque:GetError()))
    EndIf

    FwFreeObj(oPCEstoque)

Return lRet

/*/{Protheus.doc} SAIDAESTOQUE
    Baixa de saida de estoque (MATA240).
/*/
WSMETHOD POST SAIDAESTOQUE WSSERVICE PecCodeMovEstoque

    Local lRet       As Logical
    Local oPCEstoque As Object

    Self:cPayload := ::GetContent()
    Self:SetContentType("application/json")
    oPCEstoque := PecCodeEstoque():New(Self:cPayload, @Self)

    lRet := oPCEstoque:baixaEstoqueSaida()
    FwFreeObj(oPCEstoque)

Return lRet

/*/{Protheus.doc} ESTORNOESTOQUE
    Estorno de movimentacao de estoque (MATA240).
/*/
WSMETHOD POST ESTORNOESTOQUE WSSERVICE PecCodeMovEstoque

    Local lRet       As Logical
    Local oPCEstoque As Object

    Self:cPayload := ::GetContent()
    Self:SetContentType("application/json")
    oPCEstoque := PecCodeEstoque():New(Self:cPayload, @Self)

    lRet := oPCEstoque:estornoEstoqueBaixa()
    FwFreeObj(oPCEstoque)

Return lRet

/*/{Protheus.doc} ENTRADAESTOQUE
    Entrada de estoque (MATA241).
/*/
WSMETHOD POST ENTRADAESTOQUE WSSERVICE PecCodeMovEstoque

    Local lRet       As Logical
    Local oPCEstoque As Object

    Self:cPayload := ::GetContent()
    Self:SetContentType("application/json")
    oPCEstoque := PecCodeEstoque():New(Self:cPayload, @Self)

    lRet := oPCEstoque:entradaEstoqueBaixa()
    FwFreeObj(oPCEstoque)

Return lRet

/*/{Protheus.doc} BUSCACUSTOFIXO
    Busca custos fixos conforme balancete (CT2/CT1).
/*/
WSMETHOD POST BUSCACUSTOFIXO WSSERVICE PecCodeMovEstoque

    Local lRet       As Logical
    Local oPCEstoque As Object

    Self:cPayload := ::GetContent()
    Self:SetContentType("application/json")
    oPCEstoque := PecCodeEstoque():New(Self:cPayload, @Self)

    lRet := oPCEstoque:buscaCustosFixos()
    FwFreeObj(oPCEstoque)

Return lRet
