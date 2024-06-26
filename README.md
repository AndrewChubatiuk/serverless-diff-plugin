[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)

# Serverless Diff Plugin

## Overview

Plugin for Serverless Framework v3.x which compares your local templates built by package and deployed ones.
Currently supported providers:
 - aws

# Usage

```bash
serverless diff --stage REPLACEME
```

![](https://github.com/AndrewChubatiuk/serverless-diff-plugin/blob/master/usage.gif)

# Install

Execute npm install in your Serverless project.

```bash
yarn add -D serverless-diff-plugin
```

Add the plugin to your `serverless.yml` file

```yml
plugins:
  - serverless-diff-plugin
```
