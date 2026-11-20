import type { TSESTree } from '@typescript-eslint/utils';

/** The slice of TypeScript's checker the rules read, so the workspace needs no `typescript` import. */
type TsType = {
  flags: number,
  isUnion: () => boolean,
  types?: Array<TsType>,
  getCallSignatures: () => ReadonlyArray<{ getReturnType: () => TsType }>,
};
type TypeChecker = {
  isArrayType: (type: TsType) => boolean,
  getAwaitedType: (type: TsType) => TsType | undefined,
  getTypeArguments: (type: TsType) => ReadonlyArray<TsType>,
  getNonPrimitiveType: () => TsType,
  isTypeAssignableTo: (source: TsType, target: TsType) => boolean,
};
type ParserServices = {
  program: { getTypeChecker: () => TypeChecker } | null,
  getTypeAtLocation: (node: TSESTree.Node) => TsType,
};

export type TypeInformationContext = {
  sourceCode: { parserServices?: Partial<ParserServices> },
};

/** `ts.TypeFlags.Any | ts.TypeFlags.Unknown`. */
const ANY_OR_UNKNOWN = 1 | 2;

export type TypeReader = {
  /** Whether the expression's type is an array, or a union holding one. */
  isArray: (node: TSESTree.Node) => boolean,
  /** Whether the function resolves to an array, or to a type that says nothing (`any`, `unknown`). */
  returnsArray: (fn: TSESTree.Node) => boolean,
  /** Whether the function resolves to an array of objects, or to a type that says nothing: an array of strings or numbers has no columns. */
  returnsRows: (fn: TSESTree.Node) => boolean,
};

/** Undefined when the file is linted without type information, as in a `RuleTester` run with no project. */
export const typeReader = (context: TypeInformationContext): TypeReader | undefined => {
  const services = context.sourceCode.parserServices;
  const checker = services?.program?.getTypeChecker();
  const typeAt = services?.getTypeAtLocation;
  if (checker === undefined || typeAt === undefined) {
    return undefined;
  }
  const membersOf = (type: TsType) => (type.isUnion() ? type.types ?? [] : [type]);
  const saysNothing = (type: TsType) => (type.flags & ANY_OR_UNKNOWN) !== 0;
  const returnedMembers = (fn: TSESTree.Node): Array<TsType> => {
    const [signature] = typeAt(fn).getCallSignatures();
    if (signature === undefined) {
      return [];
    }
    const returned = signature.getReturnType();
    return membersOf(checker.getAwaitedType(returned) ?? returned);
  };
  const isRow = (type: TsType) => saysNothing(type) || checker.isTypeAssignableTo(type, checker.getNonPrimitiveType());
  return {
    isArray: (node) => membersOf(typeAt(node)).some((member) => checker.isArrayType(member)),
    returnsArray: (fn) => returnedMembers(fn).some((member) => checker.isArrayType(member) || saysNothing(member)),
    returnsRows: (fn) => returnedMembers(fn).some((member) => saysNothing(member)
      || (checker.isArrayType(member) && checker.getTypeArguments(member).some((element) => membersOf(element).some(isRow)))),
  };
};
