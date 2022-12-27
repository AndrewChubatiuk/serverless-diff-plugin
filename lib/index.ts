import { readFile } from 'fs/promises';
import { join } from 'path';
import { Provider } from './specs'
import { ServerlessError } from '@serverless-components/core'

interface ServerlessProvider {
    naming: {
        getCompiledTemplateFileName: () => string;
        getStackName: () => string;
    },
}

interface DiffCommon {
    providersPath: string,
    [key: string]: any, // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Serverless {
    getProvider: (name: string) => ServerlessProvider;
    serviceDir: string,
    cli: {
        log: (msg: string) => void;
    },
    pluginManager: {
        spawn: (cmd: string) => void
    },
    service: {
        package: {
            path: string,
        }
        custom: {
            diff: DiffCommon,
        },
        provider: {
            name: string
            [key: string]: any // eslint-disable-line @typescript-eslint/no-explicit-any
        }
    }
}

class ServerlessPlugin {
    protected serverless: Serverless;
    protected newTemplateFile: string;
    protected specName: string;
    protected _specProvider: Provider;
    protected providerName: string;
    public hooks: object;
    public commands: object;

    constructor(serverless: Serverless) {
        this.serverless = serverless;

        this.commands = {
            diff: {
                usage: 'Compares new AWS CloudFormation templates against old ones',
                lifecycleEvents: ['diff'],
            },
        };

        /* istanbul ignore next */
        this.hooks = {
            'before:diff:diff': async () => {
                await this.load();
                if (!this.serverless.service.package.path) {
                    await this.serverless.pluginManager.spawn('package');
                }
            },
            'diff:diff': async () => {
                await this.diff();
            },
        };


        this.providerName = this.serverless.service.provider.name;
        if (!this.serverless.getProvider(this.providerName)) {
            const errorMessage = `The specified provider '${this.providerName}' does not exist.`;
            throw new ServerlessError(errorMessage, 'PROVIDER_NOT_FOUND');
        }

        const provider = this.serverless.getProvider(this.providerName);
        const newTemplateName = provider.naming.getCompiledTemplateFileName();
        this.newTemplateFile = join(
            this.serverless.serviceDir,
            '.serverless',
            newTemplateName,
        );
        this.specName = provider.naming.getStackName();
    }

    public get specProvider() {
        return this._specProvider;
    }

    async load() {
        const custom = this.serverless.service.custom;
        const config = Object.assign({}, {
            providersPath: './providers',
        }, custom && custom.diff || {});
        try {
            this.serverless.cli.log(`Loading '${this.providerName}' module`);
            const providerMod = await import(`${config.providersPath}/${this.providerName}`);
            const SpecProvider = providerMod.SpecProvider;
            const log = this.serverless.cli.log;
            const provider = this.serverless.service.provider;
            this._specProvider = new SpecProvider(provider, config, log);

        } catch (err) {
            throw new ServerlessError(`No '${this.providerName}' spec provider found: ${err.message}`, 'NO_MODULE_FOUND');
        }
    }

    async diff() {
        this.serverless.cli.log('Running diff against deployed template');
        try {
            const data = await readFile(this.newTemplateFile, 'utf8');
            const newTemplate = JSON.parse(data);
            return this._specProvider.diff(this.specName, newTemplate);
        } catch (err) {
            if (err.code === 'ENOENT') {
                const errorPrefix = `${this.newTemplateFile} could not be found`;
                throw new ServerlessError(errorPrefix, 'NEW_TEMPLATE_NOT_FOUND');
            }
            throw new ServerlessError(err.message, 'UNKNOWN_ERROR');
        }
    }
}

export = ServerlessPlugin;
