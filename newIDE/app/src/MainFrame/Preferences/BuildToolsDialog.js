// @flow
import React from 'react';
import { type I18n } from '@lingui/core';
import Dialog from '../../UI/Dialog';
import { Trans } from '@lingui/macro';
import FlatButton from '../../UI/FlatButton';
import { ColumnStackLayout } from '../../UI/Layout';
import Text from '../../UI/Text';
import ErrorBoundary from '../../UI/ErrorBoundary';
import optionalRequire from '../../Utils/OptionalRequire';
import { localElectronExportPipeline } from '../../ExportAndShare/LocalExporters/LocalElectronExport';

const electron = window.require ? window.require('electron') : null;
const { ipcRenderer } = electron;
const fs = window.require('fs');
const path = optionalRequire('path');
const { spawn } = window.require('child_process');

type Props = {|
    i18n: I18n,
    onClose: () => void,
    project: gdProject,
|};

async function waitProcessFinish(child) {
    return await new Promise((resolve, reject) => child.on('close', resolve));
}

async function commandExists(cmd: string): boolean {
    let isWin = window.require('os').platform().indexOf('win') > -1;
    let where = isWin ? 'where' : 'whereis';
    let child = spawn(where, [cmd]);
    return waitProcessFinish(child) === 0;
}

const BuildToolsDialog = ({
    i18n,
    onClose,
    project,
}: Props) => {
    const [status1, setStatus1] = React.useState("Downloading Files");
    const [status2, setStatus2] = React.useState("");
    const [canClose, setCanClose] = React.useState(false);
    React.useEffect(() => {
        async function buildToolsSetup() {
            let buildToolsPath: string = path.join(await ipcRenderer.invoke("get-user-data"), "Build Tools");
            fs.mkdirSync(buildToolsPath, { recursive: true });

            // Downloading Node.js if it's not available
            if (!await commandExists("node")) {
                let nodePath: string = path.join(buildToolsPath, "Node")

                // Downloading portable Node.js
                if (!fs.existsSync(nodePath)) {
                    setStatus2("Downloading Node.js Portable");
                    let nodeZip: string = path.join(buildToolsPath, "node.zip");
                    if (!fs.existsSync(nodeZip))
                        await ipcRenderer.invoke('local-file-download',
                            // TODO: function to get the latest node archive URL
                            "https://nodejs.org/dist/v23.5.0/node-v23.5.0-win-x64.zip",
                            nodeZip);
    
                    setStatus2("Unzipping NodeJS Portable");
    
                    let folderName = await ipcRenderer.invoke("unzip-file", nodeZip, buildToolsPath);
                    fs.renameSync(path.join(buildToolsPath, folderName), nodePath);
                    fs.rmSync(nodeZip);
                }

                await ipcRenderer.invoke("add-to-path", nodePath);
            }
            
            // For some reason yarn doesn't work for me anymore? Will check later what's wrong
            // Will use npm for now

            /*
            // Downloading yarn if it's not available
            if (!await commandExists("yarn")) {
                let yarnPath: string = path.join(buildToolsPath, "Yarn");

                if (!fs.existsSync(yarnPath)) {
                    setStatus2("Installing yarn");
                    await ipcRenderer.invoke("child-process", "npm install yarn", buildToolsPath);

                    fs.renameSync(
                        path.join(buildToolsPath, "node_modules", "yarn"),
                        yarnPath
                    );
                    // TODO: doesn't work
                    fs.rmSync(path.join(buildToolsPath, "node_modules"), {recursive: true, force: true});
                    fs.rmSync(path.join(buildToolsPath, "package.json"));
                    fs.rmSync(path.join(buildToolsPath, "package-lock.json"));
                }

                await ipcRenderer.invoke("add-to-path", path.join(yarnPath, "bin"));
            }
            */
            
            setStatus2("Building project");
            let buildPath: string = path.join(buildToolsPath, "Build")
            fs.mkdirSync(buildPath, { recursive: true });

            let preparedExporter = await localElectronExportPipeline.prepareExporter(null);
            let context = {
                project: project,
                exportState: {
                    outputDir: buildPath
                }
            };
            
            await localElectronExportPipeline.launchExport(context, preparedExporter);

            setStatus2("Installing dependencies");
            await ipcRenderer.invoke("child-process", "npm install", buildPath);

            setStatus1("Success!");
            setStatus2("");
            setCanClose(true);
        }
        buildToolsSetup();
    }, [project]);
    return (
        <Dialog
            title={<Trans>Setting Up Build Tools</Trans>}
            actions={[
                <>
                {(canClose && <FlatButton
                    key="close"
                    label={<Trans>Close</Trans>}
                    primary={false}
                    onClick={() => onClose()}
                    />)}
                </>
            ]}
            onRequestClose={() => onClose()}
            open
            maxWidth="sm"
        >
            <ColumnStackLayout noMargin>
                <Text size="block-title">
                    <Trans>{status1}</Trans>
                </Text>
                <Text>
                    <Trans>{status2}</Trans>
                </Text>
            </ColumnStackLayout>
        </Dialog>
    )
}

const BuildToolsDialogWithErrorBoundary = (props: Props) => (
    <ErrorBoundary
      componentTitle={<Trans>Setting Up Build Tools</Trans>}
      scope="buildTools"
      onClose={() => props.onClose()}
    >
      <BuildToolsDialog {...props} />
    </ErrorBoundary>
  );
  
  export default BuildToolsDialogWithErrorBoundary;