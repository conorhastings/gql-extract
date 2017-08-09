const recast = require("recast");
const fs = require("fs");
const mkdirp = require("mkdirp");
const nodePath = require("path");

function parser(options) {
	return {
		parse(code) {
			return require("babylon").parse(code, {
				sourceType: "module", plugins: options
			});
		}
	};
};

const DEFAULT_BABYLON_PLUGINS = ["jsx", "classProperties", "dynamicImport", "objectRestSpread"];

module.exports = function({ source , filePath, babylonPlugins = DEFAULT_BABYLON_PLUGINS }) {
	const ast = recast.parse(source, { parser: parser(babylonPlugins) });
	mkdirp.sync(nodePath.join(filePath));
	const newImports = new Map();

	function extractQuery(node) {
		const type = node && node.type;
		if (type === "TaggedTemplateExpression") {
			const tag = node.tag.name;
			if (tag === "gql") {
				const literal = node.quasi.quasis[0].value.raw;
				const splitLiteral = literal.split(" ");
				const name = splitLiteral.find((_, index) => splitLiteral[index -1] === "query");
				const queryFilePath = nodePath.join(filePath, `${name}.graphql`);
				fs.writeFileSync(queryFilePath, literal, "utf8");
				newImports.set(name, queryFilePath);
				return { name, queryFilePath };
			}
		}
		return false;
	}

	recast.visit(ast, {
		visitImportDeclaration(path) {
			const moduleName = path.node.source.value;
			if (moduleName === "graphql-tag") {
				path.prune();
			}
			return false;
		},
		visitVariableDeclarator(path) {
			const init =  path.node && path.node.init;
			const queryInfo = extractQuery(init);
			if (queryInfo) {
				if (path.parent.parent.value.type === "ExportNamedDeclaration") {
					path.parent.parent.replace(
						recast.parse(`export { ${queryInfo.name} } from "${queryInfo.queryFilePath}";\n`).program.body[0],
						path.parent.parent.node
					);
				}
				else {
					path.prune();
				}
			}
			return false;
		},
		visitExportDefaultDeclaration(path) {
			const declaration = path.node.declaration;
			const queryInfo = extractQuery(declaration);
			if (queryInfo) {
				path.replace(
					recast.parse(`export default ${queryInfo.name};\n`).program.body[0],
					path.node
				);
			}
			return false;
		}
	});
	newImports.forEach((filePath, name) => {
		ast.program.body = recast.parse(`import ${name} from "${filePath}";\n`).program.body.concat(ast.program.body);
	});
	ast.program.body = ast.program.body.filter(node => {
		if (
			node.type === "ExportNamedDeclaration" &&
			node.declaration &&
			node.declaration.declarations &&
			node.declaration.declarations[0] &&
			node.declaration.declarations[0].init &&
			node.declaration.declarations[0].init.type === "TaggedTemplateExpression" &&
			node.declaration.declarations[0].init.tag.name === "gql"
		) {
			return false;
		} else if (
			node.type === "ExportDefaultDeclaration" &&
			node.declaration &&
			node.declaration.type === "TaggedTemplateExpression" &&
			node.declaration.tag.name === 'gql'
		) {
			return false;
		}
		return true;
	});
	return recast.print(ast).code;
};
