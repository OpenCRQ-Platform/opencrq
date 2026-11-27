# HTTPS and private certificate authorities

OpenCRQ must be served over HTTPS on any address other than localhost, whatever the deployment
(containers, Kubernetes, a virtual machine). This page explains why, what to put in front of
OpenCRQ, how to make its backend trust a private certificate authority (CA), and gives a lab recipe
that uses one CA for the whole platform.

## HTTPS is required

OpenCRQ does not terminate TLS itself. An ingress controller, a load balancer or a reverse proxy
does, and forwards plain HTTP to the application port (`HTTP_SERVER__PORT`, `3002` in the published
image). The public URL, `XTM_ONE__PLATFORM_URL`, is the `https://` address that proxy answers on.

Three things make plain HTTP fail on any other host than `localhost`, `127.0.0.1` or `[::1]`:

- **Sign-in goes through XTM One.** XTM One refuses a sign-in callback that is not HTTPS, a loopback
  address aside, and OpenCRQ has no local password sign-in to fall back on. With an `http://`
  `XTM_ONE__PLATFORM_URL`, OpenCRQ sends no callback, logs a warning, and nobody can sign in (see
  [Sign in with XTM One](configuration.md#xtm-one-ai-assistant)).
- **The session cookie is `Secure`.** In production the cookie is sent with `Secure` and
  `SameSite=None`, so a browser on plain HTTP never stores it and no session survives a request.
- **The Content Security Policy upgrades every request.** OpenCRQ sends `upgrade-insecure-requests`,
  so over plain HTTP the browser rewrites every script, stylesheet and API request of the page to
  `https://`. Nothing answers TLS on that port, the requests fail, and the page stays blank (a dark
  background and nothing else). The server logs show nothing wrong, since the failing requests never
  reach it.

A blank page on a non-localhost address, with a healthy server, is therefore the signature of plain
HTTP. Open the browser's developer tools: the network tab lists the requests that failed on the
`https://` address.

Put the certificate on the entry point:

- **Kubernetes**: give each ingress a `tls` block naming a Secret that holds the certificate and its
  key, issued by a CA the browsers trust (an internal one, or one obtained through cert-manager).
- **Anything else**: terminate TLS on the load balancer or reverse proxy, and forward to OpenCRQ over
  HTTP on the internal network.

A proxy that rewrites the `Host` header costs every sign-in one extra redirect (see **One address**
in [Sign in with XTM One](configuration.md#xtm-one-ai-assistant)).

## Trusting a private CA for the backend

A platform served under a private CA, or a self-signed certificate, needs two separate trusts:

- **The browser** must trust the certificate of OpenCRQ and of XTM One, or it refuses both pages.
- **The OpenCRQ backend** must trust the certificate of every HTTPS service it calls: XTM One
  (`XTM_ONE__URL`), and the OpenCTI and OpenAEV instances of the [connectors](configuration.md#connectors)
  when their URLs are `https://` under a private CA. Without it the calls fail with a certificate
  error such as `unable to verify the first certificate` or `self-signed certificate in certificate
  chain`, and the XTM One toast reports XTM One as not answering.

The backend runs on Node.js, which reads additional root certificates from the file named by
`NODE_EXTRA_CA_CERTS`, once at process start. Mount a PEM bundle in the container and set the
variable. The bundle is added to Node's built-in roots, it does not replace them, so public
endpoints keep working, and verification stays on: the host name must still match the certificate.

It has to be an environment variable of the container, not a key of a configuration file, and the
worker process inherits it from the process manager. A path that does not exist does not stop the
boot: Node only prints `Ignoring extra certs from ..., load failed` at startup, and the calls then
fail as if the variable were unset.

| Variable               | Required | Default Value | Architectural/Functional Impact                                                                                                           |
|:-----------------------|:--------:|:--------------|:------------------------------------------------------------------------------------------------------------------------------------------|
| `NODE_EXTRA_CA_CERTS`  |    No    | -             | Absolute path of a PEM file, one or several certificates, trusted in addition to the built-in roots for every outgoing HTTPS call of the backend and of its worker process. Read at start: restart after changing the file. |

On Kubernetes, put the CA in a ConfigMap (a certificate is not a secret) and mount it:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: lab-ca
data:
  ca.pem: |
    -----BEGIN CERTIFICATE-----
    ...
    -----END CERTIFICATE-----
---
# In the OpenCRQ Deployment's pod spec
containers:
  - name: opencrq
    env:
      - name: NODE_EXTRA_CA_CERTS
        value: /etc/opencrq/ca/ca.pem
    volumeMounts:
      - name: lab-ca
        mountPath: /etc/opencrq/ca
        readOnly: true
volumes:
  - name: lab-ca
    configMap:
      name: lab-ca
```

With Docker, mount the file and set the variable on the OpenCRQ service:

```yaml
services:
  opencrq:
    environment:
      NODE_EXTRA_CA_CERTS: /etc/opencrq/ca/ca.pem
    volumes:
      - ./lab-ca.pem:/etc/opencrq/ca/ca.pem:ro
```

When the CA is a chain (a root and an intermediate), put every certificate of the chain in the same
file, one after the other.

XTM One, OpenCTI and OpenAEV each have their own way of trusting a private CA for the calls they
make to OpenCRQ: follow their documentation. A CA trusted by one product is not trusted by the
others.

## Lab recipe: one CA for the whole platform

In a lab, one CA signs the certificates of OpenCRQ, XTM One, OpenCTI and OpenAEV, so each trust is
configured once. There are two ways to get the certificates; the last two steps are the same.

### Option A: a cert-manager CA issuer

This needs [cert-manager](https://cert-manager.io/) in the cluster. Three objects make a
self-signed CA, then an issuer that signs with it:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: lab-selfsigned
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: lab-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: lab-ca
  secretName: lab-ca
  duration: 87600h
  privateKey:
    algorithm: ECDSA
    size: 256
  issuerRef:
    name: lab-selfsigned
    kind: ClusterIssuer
    group: cert-manager.io
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: lab-ca
spec:
  ca:
    secretName: lab-ca
```

The `lab-ca` Secret sits in the namespace cert-manager keeps cluster-wide secrets in (`cert-manager`
by default), which is where a `ClusterIssuer` of kind `ca` reads it.

Every ingress of the platform then asks for its certificate from that issuer:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: opencrq
  annotations:
    cert-manager.io/cluster-issuer: lab-ca
spec:
  tls:
    - hosts:
        - opencrq.lab.example.com
      secretName: opencrq-tls
  rules:
    - host: opencrq.lab.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: opencrq
                port:
                  number: 3002
```

cert-manager creates the `opencrq-tls` Secret and renews it. Export the CA certificate for the next
two steps:

```bash
kubectl get secret lab-ca -n cert-manager -o jsonpath='{.data.tls\.crt}' | base64 -d > lab-ca.pem
```

### Option B: a wildcard certificate in a TLS Secret

Without cert-manager, make a CA and one wildcard certificate with `openssl` (run in a Bash shell),
and reuse its Secret in every ingress:

```bash
openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj "/CN=Lab CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout lab-ca.key -out lab-ca.pem

openssl req -newkey rsa:2048 -nodes -subj "/CN=*.lab.example.com" \
  -keyout wildcard.key -out wildcard.csr

openssl x509 -req -in wildcard.csr -CA lab-ca.pem -CAkey lab-ca.key -CAcreateserial -days 397 \
  -extfile <(printf 'subjectAltName=DNS:*.lab.example.com,DNS:lab.example.com\nextendedKeyUsage=serverAuth') \
  -out wildcard.pem
```

A Secret lives in one namespace, so create it in each namespace that holds an ingress:

```bash
kubectl create secret tls lab-wildcard --cert=wildcard.pem --key=wildcard.key -n <namespace>
```

Every ingress then names it, with no issuer annotation:

```yaml
spec:
  tls:
    - hosts:
        - opencrq.lab.example.com
      secretName: lab-wildcard
```

Keep `lab-ca.key` out of the cluster: only `lab-ca.pem` is shared.

### Trust the CA in the browser

Import `lab-ca.pem` as a trusted root authority on every machine that opens the platform:

- **Windows**: `certutil -addstore -f Root lab-ca.pem` from an administrator prompt, or open the file
  and install it in "Trusted Root Certification Authorities".
- **macOS**: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain lab-ca.pem`.
- **Linux**: copy the file to `/usr/local/share/ca-certificates/lab-ca.crt` and run
  `sudo update-ca-certificates`. Chromium-based browsers keep their own store: import it under
  Settings, Privacy and security, Manage certificates, Authorities.
- **Firefox** keeps its own store on every system: Settings, Privacy & Security, View Certificates,
  Authorities, Import.

Restart the browser afterwards.

### Give the CA to the OpenCRQ backend

Mount `lab-ca.pem` in the OpenCRQ container and set `NODE_EXTRA_CA_CERTS`, as in
[Trusting a private CA for the backend](#trusting-a-private-ca-for-the-backend). Do the same for the
other products of the platform that call OpenCRQ or each other over HTTPS.

Restart OpenCRQ, then open `https://opencrq.lab.example.com`: the page loads, "Sign in with XTM One"
appears, and the application shows no toast about XTM One not answering.
