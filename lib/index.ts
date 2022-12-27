import { readFile } from 'fs/promises';
import { join } from 'path';
import { Provider, ServerlessClasses, ServerlessLogger } from './specs'

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
    pluginManager: {
        spawn: (cmd: string) => void
    },
    classes: ServerlessClasses,
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
    protected log: ServerlessLogger;
    public hooks: object;
    public commands: object;

    constructor(serverless: Serverless, options: object, { log }) {
        this.serverless = serverless;
        this.log = log;
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
            throw new this.serverless.classes.Error(errorMessage);
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
            this.log.info(`Loading '${this.providerName}' module`);
            const providerMod = await import(`${config.providersPath}/${this.providerName}`);
            const SpecProvider = providerMod.SpecProvider;
            const provider = this.serverless.service.provider;
            this._specProvider = new SpecProvider(provider, config, this.log, this.serverless.classes);

        } catch (err) {
            throw new this.serverless.classes.Error(`No '${this.providerName}' spec provider found: ${err.message}`);
        }
    }

    async diff() {
        this.log.info('Running diff against deployed template');
        try {
            const data = await readFile(this.newTemplateFile, 'utf8');
            const newTemplate = JSON.parse(data);
            return this._specProvider.diff(this.specName, newTemplate);
        } catch (err) {
            if (err.code === 'ENOENT') {
                const errorPrefix = `${this.newTemplateFile} could not be found`;
                throw new this.serverless.classes.Error(errorPrefix);
            }
            throw new this.serverless.classes.Error(err.message);
        }
    }
}

export = ServerlessPlugin;
