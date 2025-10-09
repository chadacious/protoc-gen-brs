#!/usr/bin/env node
import { hideBin } from "yargs/helpers";
import yargs, { ArgumentsCamelCase } from "yargs";
import { generateBrightScriptArtifacts } from "./generator/generateBrightScript";
import { generateBaselineVectors } from "./generator/generateBaseline";
import { ensureWorkspace } from "./util/workspace";

type GenerateCommandArgs = {
  proto: string[];
  outDir: string;
  config?: string;
};

type BaselineCommandArgs = {
  proto: string[];
  fixtureDir: string;
};

async function main() {
  await ensureWorkspace();

  const cli = yargs(hideBin(process.argv))
    .scriptName("protoc-gen-brs")
    .command<GenerateCommandArgs>(
      "generate",
      "Generate BrightScript modules and test fixtures from .proto definitions",
      (commandYargs) =>
        commandYargs
          .option("proto", {
            alias: "p",
            type: "array",
            demandOption: true,
            describe: "List of proto files or directories to process"
          })
          .option("outDir", {
            alias: "o",
            type: "string",
            describe: "Destination for generated BrightScript files",
            default: "generated/source"
          })
          .option("config", {
            alias: "c",
            type: "string",
            describe: "Optional JSON config describing generation options"
          }),
      async (argv: ArgumentsCamelCase<GenerateCommandArgs>) => {
        const protoLocations = argv.proto.map(String);
        await generateBrightScriptArtifacts({
          protoPaths: protoLocations,
          outputDir: String(argv.outDir),
          configPath: argv.config ? String(argv.config) : undefined
        });
      }
    )
    .command<BaselineCommandArgs>(
      "baseline",
      "Produce JSON baseline encode/decode vectors derived from protobufjs",
      (commandYargs) =>
        commandYargs
          .option("proto", {
            alias: "p",
            type: "array",
            demandOption: true,
            describe: "List of proto files used to generate baseline vectors"
          })
          .option("fixtureDir", {
            alias: "f",
            type: "string",
            default: "fixtures/baseline",
            describe: "Output directory for the JSON baseline fixtures"
          }),
      async (argv: ArgumentsCamelCase<BaselineCommandArgs>) => {
        const protoLocations = argv.proto.map(String);
        await generateBaselineVectors({
          protoPaths: protoLocations,
          fixtureDir: String(argv.fixtureDir)
        });
      }
    )
    .demandCommand(1)
    .strict()
    .help();

  await cli.parseAsync();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
