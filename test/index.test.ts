import { mockClient } from 'aws-sdk-client-mock';
import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { diffTemplate, TemplateDiff } from '@aws-cdk/cloudformation-diff';
import { unlink, chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve, join } from 'path';
import { randomBytes } from 'crypto';
import { vol } from 'memfs';

jest.mock('fs');
jest.mock('fs/promises');

import ServerlessPlugin from '../lib/index';
import { SpecProviderBase, Template, ConfigBase } from '../lib/specs';
import { SpecProvider } from '../lib/providers/aws';

class AWSError extends Error {
    name: string
    message: string
    constructor(name: string, message: string) {
        super();
        this.name = name;
        this.message = message;
    }
}

const resultsBaseDir = "results"

let serverless;
let templatePath;

function randomString(length: number): string {
    return randomBytes(length).toString('hex');
}

beforeEach(async () => {
    vol.reset();
    const suffix = randomString(8);
    serverless = {
        serviceDir: resolve(__dirname, resultsBaseDir),
        service: {
            provider: {
                name: `provider-${suffix}`,
                stage: `stage-${suffix}`,
                region: 'eu-west-1',
                naming: {
                    getStackName: () => `stack-${suffix}`,
                    getCompiledTemplateFileName: () => `template-${suffix}.json`,
                },
            },
            custom: {
                diff: {
                    excludes: undefined,
                    reportPath: undefined,
                    providersPath: 'providers',
                }
            },
        },
        cli: {
            log: jest.fn(),
        },
    };
    serverless.getProvider = (providerName) => {
        serverless.cli.log(`using ${providerName} provider`);
        if (serverless.service.provider.name == providerName) {
            return serverless.service.provider;
        } else {
            return undefined;
        }
    };
    const slsDir = join(
        resultsBaseDir,
        ".serverless",
    );
    templatePath = resolve(
        __dirname,
        slsDir,
        serverless.service.provider.naming.getCompiledTemplateFileName()
    );
    await mkdir(dirname(templatePath), { recursive: true });
    await writeFile(templatePath, JSON.stringify({
        Resources: {
            Test: {
                Type: 'AWS::Lambda::Function',
                Properties: {
                    Handler: 'index.handler',
                    Runtime: 'python3.9',
                },
            },
        },
    }, null, 4));
});

describe('serverless-plugin-diff', () => {
    let providerName;
    beforeEach(() => {
        providerName = serverless.service.provider.name;
        interface TestProvider { param: string; }
        interface TestConfig extends ConfigBase { param: string; }
        jest.doMock(`providers/${providerName}`, () => {
            return {
                __esModule: true,
                SpecProvider: class extends SpecProviderBase<TestProvider, TestConfig> {
                    setup() {
                        this.log('inside provider setup()');
                    }
                    async diff(specName: string, newTpl: Template) {
                        this.log(`${specName}-${newTpl}`);
                        return { specName: specName };
                    }
                }
            }
        }, {
            virtual: true,
        });
    });
    describe('ServerlessPlugin', () => {
        let plugin;
        beforeEach(() => {
            plugin = new ServerlessPlugin(serverless);
        })
        test('load successfully with existing stack plugin', async () => {
            await plugin.load();
            expect(plugin.specProvider).toMatchObject({
                provider: {
                    name: providerName,
                },
            });
        });
        test('generate valid diff', async () => {
            await plugin.load();
            expect(await plugin.diff()).toMatchObject({
                specName: serverless.service.provider.naming.getStackName(),
            });
        });
        test('unknown error during diff generation', async () => {
            await chmod(templatePath, 0o000);
            try {
                await plugin.diff();
            } catch (err) {
                expect(err.message).toMatch(/EACCES: permission denied.*/);
            }
        });
        test('fail diff when spec doesnt exist', async () => {
            await unlink(templatePath);
            try {
                await plugin.diff();
            } catch (err) {
                expect(err.message).toMatch(/.* could not be found/);
            }
        });
        test('run unsuccessfully with not-existing stack plugin', async () => {
            jest.dontMock(`providers/${providerName}`);
            try {
                await plugin.load();
            } catch (err) {
                expect(err.message).toMatch(/No '[\w-]+' spec provider found.*/);
            }
        });
        test('run unsuccessfully with not-existing plugin name', () => {
            serverless.getProvider = (providerName) => {
                serverless.cli.log(`using ${providerName} provider`);
                if ('not-existing' == providerName) {
                    return serverless.service.provider;
                } else {
                    return undefined;
                }
            };
            expect(() => {
                new ServerlessPlugin(serverless)
            }).toThrowWithMessage(Error, /The specified provider '[\w-]+' does not exist./);
        });

        test('registers the appropriate hooks', () => {
            expect(typeof plugin.hooks['before:diff:diff']).toBe('function');
            expect(typeof plugin.hooks['diff:diff']).toBe('function');
        });
        test('check provider execution fails', async () => {
            interface TestProvider { param: string; }
            interface TestConfig extends ConfigBase { param: string; }
            jest.doMock(`providers/${providerName}`, () => {
                return {
                    __esModule: true,
                    SpecProvider: class extends SpecProviderBase<TestProvider, TestConfig> {
                        setup() {
                            this.log('inside provider setup()');
                        }
                        diff(specName: string, newTpl: Template) {
                            this.log(`${specName}-${newTpl}`);
                            throw new Error('Error');
                        }
                    }
                }
            }, {
                virtual: true,
            });
            await plugin.load();
            try {
                await plugin.diff();
            } catch (err) {
                expect(err.message).toMatch(/Error/);
            }
        });
    });
    describe('SpecProviderBase', () => {
        let providerMod;
        beforeEach(async () => {
            providerMod = await import(`providers/${providerName}`)
        });
        test('exclude non existing path', () => {
            serverless.service.custom.diff.excludes = [
                `$.Resources.Test.Properties.Handler`,
            ]
            const provider = new providerMod.SpecProvider(
                serverless.service.provider,
                serverless.service.custom.diff,
                serverless.cli.log,
            );
            expect(provider.exclude(serverless)).toEqual(serverless);
        });
        test('exclude existing jsonpath key', () => {
            serverless.service.custom.diff.excludes = [
                `$.service`,
                `$.serviceDir`,
                `$.getProvider`,
            ]
            const provider = new providerMod.SpecProvider(
                serverless.service.provider,
                serverless.service.custom.diff,
                serverless.cli.log,
            );
            expect(provider.exclude(serverless)).toEqual({
                cli: serverless.cli,
            });
        });
        test('generate report with undefined path', async () => {
            const provider = new providerMod.SpecProvider(
                serverless.service.provider,
                serverless.service.custom.diff,
                serverless.cli.log,
            );
            const startFsSize = vol.toJSON().size;
            provider.generateReport({});
            const endFsSize = vol.toJSON().size;
            expect(endFsSize).toEqual(startFsSize);
        });
        test('generate report with defined path', async () => {
            const reportPath = `report-${randomString(8)}.json`;
            serverless.service.custom.diff.reportPath = reportPath;
            const provider = new providerMod.SpecProvider(
                serverless.service.provider,
                serverless.service.custom.diff,
                serverless.cli.log,
            );
            const bar = `bar-${randomString(8)}`
            provider.generateReport({ foo: bar });
            expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual({
                foo: bar,
            });
        });
    });
    describe('AWS: SpecProvider', () => {
        let provider;
        const mockCfnClient = mockClient(CloudFormationClient);
        beforeEach(() => {
            mockCfnClient.reset();
            class AWSSpecProvider extends SpecProvider {
                public exec(oldTemplate: Template, newTemplate: Template): TemplateDiff {
                    return super.exec(oldTemplate, newTemplate);
                }
            }
            provider = new AWSSpecProvider(
                serverless.service.provider,
                serverless.service.custom.diff,
                serverless.cli.log,
            );

        });
        test('exec no diff', () => {
            const diff = provider.exec({}, {});
            expect(diff.isEmpty).toBe(true);
        });
        test('exec with diff and undefined width', () => {
            const diff = provider.exec({ foo: 'bar' }, {});
            expect(diff.unknown).toMatchObject({
                diffs: {
                    foo: {
                        isDifferent: true,
                    },
                },
            });
        });
        test('report with resources manipulations', () => {
            const diff = diffTemplate({
                Resources: {
                    Test: {
                        Type: 'AWS::Lambda::Function',
                        Properties: {
                            Handler: 'index.handler',
                            Runtime: 'python3.9',
                        },
                    },
                    TestDelete: {
                        Type: 'AWS::Lambda::Function',
                        Properties: {
                            Handler: 'index.handler',
                            Runtime: 'python3.9',
                        },
                    },
                },
            }, {
                Resources: {
                    Test: {
                        Type: 'AWS::Lambda::Function',
                        Properties: {
                            Handler: 'index.handler',
                            Runtime: 'python3.8',
                        },
                    },
                    TestCreate: {
                        Type: 'AWS::Lambda::Function',
                        Properties: {
                            Handler: 'index.handler',
                            Runtime: 'python3.9',
                        },
                    },
                },
            });
            expect(provider.report(diff)).toEqual({
                create: 1,
                delete: 1,
                update: 1,
            });
        });
        test('diff remote template successful extraction', () => {
            mockCfnClient.on(GetTemplateCommand).resolves({
                TemplateBody: '{"foo":"bar"}',
            });
            provider.client = mockCfnClient;
            provider.diff(`test-${randomString(8)}`, { foo: 'bar' });
        });
        test('diff remote template does not exists', () => {
            const stackName = `test-${randomString(8)}`;
            mockCfnClient.on(GetTemplateCommand).rejects(new AWSError(
                'ValidationError',
                `Stack with id ${stackName} does not exist`,
            ));
            provider.client = mockCfnClient;
            expect(provider.diff(stackName, { foo: 'bar' })).resolves.toMatchObject({
                unknown: {
                    diffs: {
                        foo: {
                            newValue: 'bar',
                        },
                    },
                },
            });
        });
        test('diff remote template unknown error', async () => {
            const stackName = `test-${randomString(8)}`;
            const errMessage = `Don't know what to do with a stack named ${stackName}`;
            mockCfnClient.on(GetTemplateCommand).rejects(new AWSError(
                'OtherError',
                errMessage,
            ));
            provider.client = mockCfnClient;
            try {
                await provider.diff(`test-${randomString(8)}`, { foo: 'bar' })
            } catch (err) {
                expect(err.message).toMatch(errMessage);
            }
        });
    });
});
