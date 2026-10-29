#!/usr/bin/env node
/**
 * Complexity budget for `apps/web/lib`.
 *
 * Why a purpose-built script instead of an ESLint/Biome rule:
 *
 * - Biome 1.9 (the linter this repository already uses) has no per-function
 *   cyclomatic-complexity metric, and adding ESLint would mean a second linter,
 *   a second config surface and a second CI step.
 * - TypeScript is already a dev dependency of `apps/web`, so the parser is
 *   already on disk. This script uses the compiler API directly and adds no
 *   dependency at all.
 *
 * Metric: cyclomatic complexity per function - 1 + the number of decision
 * points (if, case, ternary, for/for-in/for-of, while, do, catch, &&, ||, ??)
 * inside that function. Nested functions get their own score; their branches do
 * not inflate the enclosing function.
 *
 * Two budgets are enforced, both set just above the measured baseline on
 * 2026-10-29 (see `complexity-budget.json` and docs/adr):
 *
 * - per function: catches a function that grows another branch;
 * - per file: catches a new file assembled from many medium functions.
 *
 * Tests are excluded: they branch to describe cases, not to encode product
 * logic, and a test that is hard to read is a test-design issue, not a module
 * complexity issue.
 *
 * Usage:
 *   node scripts/check-complexity.mjs            # enforce the budget
 *   node scripts/check-complexity.mjs --report   # print the distribution only
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const libRoot = path.join(webRoot, "lib");
const budgetPath = path.join(scriptDir, "complexity-budget.json");
const reportOnly = process.argv.includes("--report");

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));

const EXCLUDED_DIRS = new Set(["__tests__", "node_modules"]);
const EXCLUDED_SUFFIXES = [".test.ts", ".test.tsx", ".d.ts"];

const DECISION_BINARY_OPERATORS = new Set(["&&", "||", "??"]);

const BUCKETS = [
	{ label: "1-5", min: 1, max: 5 },
	{ label: "6-10", min: 6, max: 10 },
	{ label: "11-15", min: 11, max: 15 },
	{ label: "16-20", min: 16, max: 20 },
	{ label: "21-25", min: 21, max: 25 },
	{ label: "26-40", min: 26, max: 40 },
	{ label: "41+", min: 41, max: Number.POSITIVE_INFINITY },
];

function listSourceFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (EXCLUDED_DIRS.has(entry.name)) continue;
			files.push(...listSourceFiles(path.join(dir, entry.name)));
			continue;
		}
		if (!entry.isFile()) continue;
		if (!/\.(ts|tsx)$/.test(entry.name)) continue;
		if (EXCLUDED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
		files.push(path.join(dir, entry.name));
	}
	return files;
}

function isFunctionLike(node) {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isConstructorDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

function ownerName(node) {
	for (let current = node.parent; current; current = current.parent) {
		if (
			(ts.isClassDeclaration(current) || ts.isClassExpression(current)) &&
			current.name &&
			ts.isIdentifier(current.name)
		) {
			return current.name.text;
		}
	}
	return null;
}

function functionName(node, sourceFile) {
	let name = null;

	if (node.name && ts.isIdentifier(node.name)) {
		name = node.name.text;
	} else if (ts.isConstructorDeclaration(node)) {
		name = "constructor";
	} else {
		const parent = node.parent;
		if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
			name = parent.name.text;
		} else if (parent && ts.isPropertyAssignment(parent)) {
			const property = parent.name;
			if (ts.isIdentifier(property) || ts.isStringLiteral(property)) name = property.text;
		} else if (parent && ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
			name = parent.name.text;
		}
	}

	const owner = ownerName(node);
	if (owner && name) return `${owner}.${name}`;
	if (name) return name;

	const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	return `<anonymous@${line + 1}>`;
}

function countDecisions(node) {
	let decisions = 0;

	const visit = (child) => {
		// Nested functions are scored separately; do not count their branches here.
		if (isFunctionLike(child)) return;

		if (
			ts.isIfStatement(child) ||
			ts.isCaseClause(child) ||
			ts.isConditionalExpression(child) ||
			ts.isForStatement(child) ||
			ts.isForInStatement(child) ||
			ts.isForOfStatement(child) ||
			ts.isWhileStatement(child) ||
			ts.isDoStatement(child) ||
			ts.isCatchClause(child)
		) {
			decisions += 1;
		} else if (
			ts.isBinaryExpression(child) &&
			DECISION_BINARY_OPERATORS.has(child.operatorToken.getText())
		) {
			decisions += 1;
		}

		ts.forEachChild(child, visit);
	};

	ts.forEachChild(node, visit);
	return decisions;
}

function analyseFile(file) {
	const sourceText = readFileSync(file, "utf8");
	const sourceFile = ts.createSourceFile(
		file,
		sourceText,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);

	const functions = [];

	const visit = (node) => {
		if (isFunctionLike(node)) {
			const complexity = 1 + countDecisions(node);
			const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
			functions.push({
				name: functionName(node, sourceFile),
				line: line + 1,
				complexity,
			});
			// Do not descend into the body: nested functions are scored on their
			// own, and descending here would double-count nothing but cost time.
			return;
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sourceFile, visit);

	const total = functions.reduce((sum, entry) => sum + entry.complexity, 0);
	return { file, functions, total };
}

function relative(file) {
	return path.relative(webRoot, file).replaceAll("\\", "/");
}

const files = listSourceFiles(libRoot).sort();
const results = [];
for (const file of files) {
	const stat = statSync(file);
	if (!stat.isFile()) continue;
	results.push(analyseFile(file));
}

const allFunctions = results.flatMap((result) =>
	result.functions.map((entry) => ({ ...entry, file: relative(result.file) })),
);

const distribution = BUCKETS.map((bucket) => ({
	label: bucket.label,
	count: allFunctions.filter(
		(entry) => entry.complexity >= bucket.min && entry.complexity <= bucket.max,
	).length,
}));

const worstFunctions = [...allFunctions].sort((a, b) => b.complexity - a.complexity);
const worstFiles = [...results].sort((a, b) => b.total - a.total);

console.log("Complexity report - apps/web/lib (tests excluded)");
console.log(`  files analysed:     ${results.length}`);
console.log(`  functions analysed: ${allFunctions.length}`);
console.log(
	`  budget:             function <= ${budget.maxFunctionComplexity}, file <= ${budget.maxFileComplexity}`,
);
console.log("");
console.log("Distribution (cyclomatic complexity per function)");
for (const bucket of distribution) {
	const bar = "#".repeat(Math.min(bucket.count, 60));
	console.log(`  ${bucket.label.padStart(6)}  ${String(bucket.count).padStart(4)}  ${bar}`);
}
console.log("");
console.log("Worst functions");
for (const entry of worstFunctions.slice(0, 10)) {
	console.log(
		`  ${String(entry.complexity).padStart(3)}  ${entry.file}:${entry.line}  ${entry.name}`,
	);
}
console.log("");
console.log("Worst files (total function complexity)");
for (const entry of worstFiles.slice(0, 5)) {
	console.log(
		`  ${String(entry.total).padStart(4)}  ${relative(entry.file)} (${entry.functions.length} functions)`,
	);
}

if (reportOnly) {
	process.exit(0);
}

const functionViolations = worstFunctions.filter(
	(entry) => entry.complexity > budget.maxFunctionComplexity,
);
const fileViolations = worstFiles.filter((entry) => entry.total > budget.maxFileComplexity);

if (functionViolations.length === 0 && fileViolations.length === 0) {
	console.log("");
	console.log("Complexity budget satisfied.");
	process.exit(0);
}

console.error("");
console.error("Complexity budget exceeded.");
for (const entry of functionViolations) {
	console.error(
		`  function  ${entry.file}:${entry.line}  ${entry.name} = ${entry.complexity} (max ${budget.maxFunctionComplexity})`,
	);
}
for (const entry of fileViolations) {
	console.error(
		`  file      ${relative(entry.file)} = ${entry.total} (max ${budget.maxFileComplexity})`,
	);
}
console.error("");
console.error("Split the function or move a branch into a named helper.");
console.error("Do not raise the budget to make a change pass: the numbers in");
console.error("scripts/complexity-budget.json are measured, and a higher budget");
console.error("needs its own justification in review.");
process.exit(1);
