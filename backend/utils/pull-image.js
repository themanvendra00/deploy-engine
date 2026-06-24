export function pullImagePromisified(docker, image, tag) {
    return new Promise((resolve, reject) => {
        docker.pull(`${image}:${tag}`, {}, (error, stream) => {
            if (error) {
                reject(error);
            }

            docker.modem.followProgress(
                stream,
                (doneErr, output) => {
                    if (doneErr) {
                        return reject(doneErr);
                    }
                    return resolve(output);
                },
                (event) => {
                    if (event.status) {
                        console.log(
                            `[pull ${image}:${tag} ${event.status}${event.progess ? ` ${event.progess}` : ""}]`,
                        );
                    }
                },
            );
        });
    });
}