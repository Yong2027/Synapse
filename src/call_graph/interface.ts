import { DocumentSymbol } from "vscode";
import { Location, Range, SymbolKind } from "vscode";

type Attr = Record<string, string | number | boolean | undefined>;

export interface ReferNode {
    func?: DocumentSymbol;
    range: Range;
    name: string;
    text: string;
    label: string;
    subgraph: Subgraph;
}
export interface Subgraph {
    name: string;
    attr?: Attr & { node?: Attr };
    cluster?: boolean;
}
/**
 * 之所以搞这个接口 是因为DocumentSymbol没有uri这些类变量 所以我们继承一下 DocumentSymbol有些东西我们还是用的上的
 */
export interface RefInformation extends DocumentSymbol {
    /**
     * The name of this symbol.
     */
    name: string;

    /**
     * The name of the symbol containing this symbol.
     */
    containerName: string;

    /**
     * The kind of this symbol.
     */
    kind: SymbolKind;

    /**
     * The location of this symbol.
     */
    location: Location;
    /**
     * The range enclosing this symbol not including leading/trailing whitespace but everything else, e.g. comments and code.
     */
    range: Range;
    /**
     * The range that should be selected and reveal when this symbol is being picked, e.g. the name of a function.
     * Must be contained by the {@linkcode DocumentSymbol.range range}.
     */
    selectionRange: Range;

    /**
     * Children of this symbol, e.g. properties of a class.
     */
    children: DocumentSymbol[];
}
