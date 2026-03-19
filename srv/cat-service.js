const cds = require('@sap/cds');
const axios = require('axios');
const https = require('https');

const fs = require("fs");
const acme = require('acme-client');
const { EOL } = require('os');
const challengeFolderPath = __dirname + '/static/.well-known/acme-challenge/';

const xsenv = require("@sap/xsenv");

const LOG = cds.log('custom');


/**
 * CF API (used for CF-Routes)
 * Also see https://github.com/SAP/cloud-foundry-tools-api
 * https://v3-apidocs.cloudfoundry.org/
 */
class CatalogService extends cds.ApplicationService {
    init() {

        /**
         * *************************************************************************************************************************************************
         * CAP Error Handling: req.error()
         * *************************************************************************************************************************************************
         * In production, errors should never disclose any internal information that could be used by malicious actors. Hence, we sanitize all server-side 
         * errors thrown by CAP framework. That is, all errors with a 5xx status code (the default status code is 500) are returned to the client with only 
         * the respective generic message (example: 500 Internal Server Error).
         * 
         * See https://cap.cloud.sap/docs/node.js/events#error-sanitization
         * *************************************************************************************************************************************************
         */

        /**
         * Show Error in Fiori Elements App
         *   -> See https://cap.cloud.sap/docs/node.js/events#req-msg
         * 
         * Examples:
         *   req.info("Show Message Toast");
         *   req.notify("Show Information Popup");
         *   req.warn("Show Warning Popup");
         *   req.error("Show Error Message");
         * 
         * Note that req.error("Message") or throw new Error("Message") only works in DEV! In PROD there will be Internal Server Error!
         *      --> instead use req.error(499, "Message")
         */

        const { Certificates, CertificateStatuses, CertificateDomains, Domains, Environments, Routes } = cds.entities(this.name);



        /**
         * Extract Custom Domain Service API URL from binded service
         */
        const customDomainService = xsenv.serviceCredentials({ label: 'INFRA' });
        LOG.debug(customDomainService);
        const customDomainApiUrl = customDomainService.url;


        /**
         * Read global settings from environment
         */
        const customDomainSettings = cds.env.for("customDomain"); // see package.json!
        LOG.debug("Custom Domain Settings", customDomainSettings);

        async function createCertificateFromCSRKey(req, certGuid, domain, alias, code) {
            if (!certGuid) {
                certGuid = req.params[0].GUID;
            }
            console.log("Create Certificate for Key (CSR) with GUID " + certGuid);

            /**
             * Check if route exists
             */
            //const acmeCheckUrl = `https://${domain}/.well-known/acme-challenge/test.txt`;

            try {
                await checkRoute(domain, req);
            } catch (error) {
                req.error(499, error);
                return;
            }

            /**
             * Set Let's Encrypt Environment: Staging (Test) / Production
             */
            var letsEncryptEnvironment = "";
            if (code === 'P') {
                letsEncryptEnvironment = acme.directory.letsencrypt.production;
            } else {
                letsEncryptEnvironment = acme.directory.letsencrypt.staging;
            }
            console.log(`Using Let's Encrypt Environment ${code} with URL ${letsEncryptEnvironment}`);

            LOG.debug("Host: " + req.headers.host);
            if (/^localhost/.test(req.headers.host)) {
                req.error(499, "ACME-Check cannot be performed on localhost");
                return;
            }

            try {

                // Get CSR
                const token = await getToken();

                /**
                 * Start Let's Encrypt Logic
                 */
                acme.setLogger((message) => {
                    LOG.debug(message);
                });

                // Create private key for signing the certificate request
                const privateRsaKey = await acme.crypto.createPrivateRsaKey();
                var options = {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                };

                const response = await axios.get(`${customDomainApiUrl}/api/v2/keys/${certGuid}/csr`, options);
                const csr = response.data;

                LOG.debug("CSR", csr);

                req.notify("CSR successfully fetched");

                /* Init client */
                const client = new acme.Client({
                    directoryUrl: letsEncryptEnvironment,
                    accountKey: privateRsaKey
                });

                /* Get Certificate */
                const cert = await client.auto({
                    csr,
                    email: customDomainSettings.email, // from package.json
                    termsOfServiceAgreed: true,
                    skipChallengeVerification: true, // Prevent Error: Hostname does not match certificate's altnames: Host is not in the cert's altnames: DNS:*.cf.eu10.hana.ondemand.com
                    challengePriority: ['http-01'], // do not use dns-challenge
                    challengeCreateFn,
                    challengeRemoveFn
                });

                /* Show result and split certificate chain into array */
                //console.log(`Certificate:\n${cert.toString()}`);
                var aCertificates = splitCertificateChain(cert.toString());
                LOG.debug(aCertificates);

                /**
                 * Use the first and second certificate (remove 3rd) and make sure you are not using STAGING-Mode !! :-)
                 */

                req.notify("Certificate Chain Successfully generated");

                if (code !== 'P') {
                    req.notify("Validation / Upload not possible in STAGING mode. Exit.");
                    return;
                }

                const certChain = aCertificates[0] + EOL + aCertificates[1];

                /**
                 * Check if certificate chain is valid
                 */
                var options = {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": 'application/pkix-cert'
                    }
                };

                const checkCertChainResponse = await axios.post(`${customDomainApiUrl}/api/v2/keys/${certGuid}/checkcertchain`, certChain, options);
                LOG.debug(checkCertChainResponse.data);

                req.notify("Certificate Chain is valid");

                /**
                 * Upload Certificate Chain
                 */
                const certChainUploadResponse = await axios.post(`${customDomainApiUrl}/api/v2/keys/${certGuid}/certchain`, certChain, options);
                LOG.debug(certChainUploadResponse.data);

                req.notify("Certificate Chain successfully uploaded");

            } catch (error) {
                req.error(499, error.message);
            }
        };

        this.on('createFromCsr', async (req) => {
            console.log("createFromCsr pressed");

            LOG.debug("Params", req.params);
            LOG.debug("Data", req.data);

            await createCertificateFromCSRKey(req, req.params[0].GUID, req.data.domain, req.data.alias, req.data.code);

        });

        this.on('renewAndActivate', async (req) => {
            console.log("Renew and Activate");
            LOG.debug("Data", req.data);

            try {
                await renewAndActivateCertificate(req, req.data.domain, req.data.alias, req.data.code);
            } catch (error) {
                req.error(499, error);
            }
        });

        this.on('createNewCsr', async (req) => {
            console.log("Create NEW pressed");
            LOG.debug(req.data);

            const alias = req.data.alias;
            const domain = req.data.domain;

            const token = await getToken();
            var options = {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: {
                    per_page: "all"/*,
                    exclude_shared: true*/
                }
            };

            /**
             * Check if Reserved Domain exists
             */
            var response = await axios.get(`${customDomainApiUrl}/api/v2/reserveddomains`, options);
            const aReservedDomains = response.data.resources;

            var oDomain = aReservedDomains.find(({ name }) => name === domain);
            if (!oDomain) {
                // Domain does not exists -> create it

                /**
                 * Create Reserved Domain
                 */
                var domainData = {
                    "name": domain
                };

                LOG.debug("Create new Reserved Domain", domainData);

                try {
                    await axios.post(`${customDomainApiUrl}/api/v2/reserveddomains`, domainData, options);
                } catch (error) {
                    var sMsg = error.response.data.error ? error.response.data.error : error.message;
                    req.error(499, sMsg);
                    return;
                }
            }


            /**
             * Check if Custom Domain exists
             */
            // https://custom-domain-certificates-api.cf.eu10.hana.ondemand.com/api/v2/customdomains?per_page=all
            response = await axios.get(`${customDomainApiUrl}/api/v2/customdomains`, options);
            const aCustomDomains = response.data.resources;

            oDomain = aCustomDomains.find(({ name }) => name === domain);
            if (!oDomain) {
                // Domain does not exists -> create it

                /**
                 * Read Landscape Information from UserInfo Endpoint (Binding specific)
                 */
                response = await axios.get(`${customDomainApiUrl}/api/v2/userinfo`, options);
                LOG.debug('UserInfo is', response.data);

                // Extract CF Landscape using descruction syntax
                const { tenant_environments: [{ cf_landscape }] } = response.data;
                LOG.debug('CF Landscape:', cf_landscape);

                /**
                 * Create Custom Domain
                 */
                domainData = {
                    "name": domain,
                    "landscape": cf_landscape
                };

                LOG.debug("Create new Custom Domain", domainData);

                try {
                    await axios.post(`${customDomainApiUrl}/api/v2/customdomains`, domainData, options);
                } catch (error) {
                    var sMsg = error.response.data.error ? error.response.data.error : error.message;
                    req.error(499, sMsg);
                    return;
                }
            }


            /**
             * Generate CSR
             */
            var data = {
                "keysize": 3072,
                "subject": [
                    {
                        "CN": domain
                    }
                ],
                "alias": alias,
                "sans": [
                    domain
                ]
            };

            try {
                response = await axios.post(`${customDomainApiUrl}/api/v2/keys`, data, options);
                const oKey = response.data;
                var result = [{ GUID: oKey.guid, alias: oKey.alias }];
                result.$count = 1;

                return result;
            } catch (error) {
                var sMsg = error.response.data.error ? error.response.data.error : error.message;
                req.warn(sMsg);
            }
        });

        async function recreateCsrFromExisting(req, domain, alias) {
            const token = await getToken();

            var data = {
                "keysize": 3072,
                "subject": [
                    {
                        "CN": domain
                    }
                ],
                "alias": alias,
                "sans": [
                    domain
                ]
            };

            var options = {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            };

            try {
                var response = await axios.post(`${customDomainApiUrl}/api/v2/keys`, data, options);
                const oKey = response.data;
                var result = [{ GUID: oKey.guid, alias: oKey.alias }];
                result.$count = 1;

                return result;
            } catch (error) {
                //var sMsg = error.response.data.error ? error.response.data.error : error.message;
                //req.error(499, sMsg);

                throw new Error("Fehler bei Zertifikat-Erstellung: " + sMsg);
            }
        };

        this.on('recreateCsrFromExisting', async (req) => {
            console.log("Recreate pressed");
            LOG.debug("Data", req.data);

            try {
                await recreateCsrFromExisting(req, req.data.domain, req.data.alias);
            } catch (error) {
                req.error(499, error);
            }
        });

        this.on('checkRoute', async (req) => {
            console.log("checkRoute pressed");
            LOG.debug(req.data);
            LOG.debug(req.params);

            const certGuid = req.params[0].GUID;
            const domain = req.data.domain;
            console.log(`Check Route with GUID ${certGuid} and domain ${domain}`);

            /**
             * Check if route exists
             */
            try {
                await checkRoute(domain, req);
            } catch (error) {
                req.error(499, error);
                return;
            }

        });

        this.on('createRoute', async (req) => {
            console.log("createRoute pressed");
            LOG.debug("Data", req.data);
            LOG.debug("Params", req.params);

            const certGuid = req.params[0].GUID;
            const domain = req.data.domain;
            LOG.debug(`Create Route with GUID ${certGuid} for domain ${domain}`);

            const token = await getToken();
            var options = {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: {
                    per_page: "all"
                }
            };

            /**
             * Check if Custom Domain exists
             */
            var response = await axios.get(`${customDomainApiUrl}/api/v2/customdomains`, options);
            const aCustomDomains = response.data.resources;

            const oDomain = aCustomDomains.find(({ name }) => name === domain);
            if (!oDomain) {
                //throw new Error("Custom Domain not found");
                req.error(499, "Custom Domain not found");
                return;
            } else {
                //console.log("Custom Domain");
                //console.log(oDomain);
                req.notify(`Custom Domain ${domain} existiert`);
            }

            /**
             * Read Landscape Information from UserInfo Endpoint (Binding specific)
             */
            response = await axios.get(`${customDomainApiUrl}/api/v2/userinfo`, options);
            LOG.debug('UserInfo is', response.data);

            // Extract CF Landscape using descruction syntax
            const { tenant_environments: [{ cf_landscape }] } = response.data;
            LOG.debug('CF Landscape:', cf_landscape);

            // Remove "cf-" from cf_landscape variable
            const landscape = cf_landscape.replace("cf-", "");


            /**
             * Cloud Foundry API Authentication
             */
            const cfApitoken = await getCfApiBearerToken(landscape);
            const cfApiOptions = {
                headers: {
                    Authorization: `Bearer ${cfApitoken}`
                }
            };

            /**
             * Check if Domain exists in Cloud Foundry
             */
            var response = await axios.get(`https://api.cf.${landscape}.hana.ondemand.com/v3/domains?names=${domain}`, cfApiOptions);
            const aCfDomains = response.data.resources;
            LOG.debug("Found Domains:", aCfDomains)

            const oCfDomain = aCfDomains.find(({ name }) => name === domain);
            if (!oDomain) {
                //throw new Error("CF Domain not found");
                req.error(499, "CF Domain not found");
                return;
            } else {
                LOG.debug("CF Domain", oCfDomain);
                req.notify(`Cloud Foundry Domain ${domain} existiert`);
            }

            LOG.debug("VCAP_APPLICATION", process.env.VCAP_APPLICATION);
            const VCAP_APPLICATION = JSON.parse(process.env.VCAP_APPLICATION);

            /**
             * Create Route in Cloud Foundry
             */
            var data = {
                "host": "",
                "path": "/.well-known/acme-challenge/",
                "port": null,
                "relationships": {
                    "domain": {
                        "data": {
                            "guid": oCfDomain.guid // wichtig: GUID der CF Domain und NICHT der Custom Domain mitgeben!
                        }
                    },
                    "space": {
                        "data": {
                            "guid": VCAP_APPLICATION.space_id
                        }
                    }
                }
            };

            try {
                LOG.debug("Route erstellen", JSON.stringify(data));

                var response = await axios.post(`https://api.cf.${landscape}.hana.ondemand.com/v3/routes`, data, cfApiOptions);
                const oCreatedRoute = response.data;
                LOG.debug("Route erstellt", oCreatedRoute);

                var createdRouteGuid = oCreatedRoute.guid;

                req.notify(`Route erfolgreich erstellt`);

            } catch (error) {
                console.log(error.toJSON());
                console.log(error?.response?.data);
                var sMsg = error.response.data.error ? error.response.data.error : error.message;

                if (Array.isArray(error?.response?.data?.errors) && error?.response?.data?.errors[0]?.detail) {
                    sMsg = error?.response?.data?.errors[0]?.detail;
                }

                //throw new Error(sMsg);
                req.error(499, sMsg);
                return;
            }

            /**
             * Bind the CF Route to the CF Application
             */
            var appOptions = {
                headers: {
                    Authorization: `Bearer ${cfApitoken}`
                },
                params: {
                    names: VCAP_APPLICATION.application_name,
                    space_guids: VCAP_APPLICATION.space_id
                }
            };

            var response = await axios.get(`https://api.cf.${landscape}.hana.ondemand.com/v3/apps`, appOptions);
            const oCfLetsencryptApp = response.data.resources[0];
            LOG.debug("Letsencrypt App", oCfLetsencryptApp);

            var routeBindingData = {
                "destinations": [
                    {
                        "app": {
                            "guid": oCfLetsencryptApp.guid,
                            "process": {
                                "type": "web"
                            }
                        },
                        "port": 8080,
                        "protocol": "http1"
                    }
                ]
            }

            try {
                LOG.debug("Binding erstellen", JSON.stringify(routeBindingData));

                var response = await axios.post(`https://api.cf.${landscape}.hana.ondemand.com/v3/routes/${createdRouteGuid}/destinations`, routeBindingData, cfApiOptions);
                const oCreatedRoute = response.data;
                LOG.debug("Binding erstellt", oCreatedRoute);

                req.notify("Binding an App erfolgreich durchgeführt");

            } catch (error) {
                console.log(error.toJSON());
                console.log(error?.response?.data);
                var sMsg = error.response.data.error ? error.response.data.error : error.message;

                if (Array.isArray(error?.response?.data?.errors) && error?.response?.data?.errors[0]?.detail) {
                    sMsg = error?.response?.data?.errors[0]?.detail;
                }

                //throw new Error(sMsg);
                req.error(499, sMsg);
                return;
            }

        });

        async function activateCertificate(req, certGuid, domain) {
            console.log(`Activate Certificate with GUID ${certGuid} and domain ${domain}`);

            const token = await getToken();

            const options = {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            };

            /**
             * Read TLS Config
             * If only one configuration exists, use it. If there are multiple configuration, use the one with name "default".
             * 
             * Example Response
                {
                    "pagination": {
                        "total_results": 2,
                        "total_pages": 1,
                        "first": {
                            "href": "https://custom-domain-certificates-api.cf.eu10.hana.ondemand.com/api/v2/tlsconfigurations?page=1&per_page=50"
                        },
                        "last": {
                            "href": "https://custom-domain-certificates-api.cf.eu10.hana.ondemand.com/api/v2/tlsconfigurations?page=1&per_page=50"
                        },
                        "next": null,
                        "previous": null
                    },
                    "resources": [
                        {
                            "guid": "04e5f5....7123",
                            "name": "default",
                            "mtls_mode": "disabled",
                            "ciphersuites": [],
                            "alpn": [
                                "h2",
                                "http/1.1"
                            ],
                            "protocol_version_min": "1.2",
                            "protocol_version_max": "1.3",
                            "status": "unUsed"
                        }
                    ]
                }                           
             */

            var tlsConfigurationsResponse = await axios.get(`${customDomainApiUrl}/api/v2/tlsconfigurations`, options);
            const tlsConfigurationsData = tlsConfigurationsResponse.data;

            // Extract the resources array
            const resources = tlsConfigurationsData.resources;

            let tlsConfigGUID;

            if (resources.length === 1) {
                // Only one entry, use the guid from this entry
                tlsConfigGUID = resources[0].guid;
            } else {
                // Multiple entries, find the entry with name = "default"
                const defaultEntry = resources.find(resource => resource.name === "default");
                if (defaultEntry) {
                    tlsConfigGUID = defaultEntry.guid;
                } else {
                    // Fallback if no entry with name "default" is found
                    console.error('No TLS configuration with name "default" found.');
                    return req.error(499, 'No TLS configuration with name "default" found.');
                }
            }


            /**
             * Prepare Certificate Activation Request
             */    
            var data = {
                "sans": [
                    domain
                ],
                "tls_config": tlsConfigGUID
            };

            try {
                var response = await axios.post(`${customDomainApiUrl}/api/v2/servercertificates/${certGuid}/activatesans`, data, options);
                req.notify(`Activation is in progress for domain ${domain}`);

            } catch (error) {
                var sMsg = error.response.data.error ? error.response.data.error : error.message;
                req.error(499, sMsg);
                return;
            }
        };

        this.on('activateCertificate', async (req) => {
            console.log("activateCertificate");
            LOG.debug("Data", req.data);
            LOG.debug("Params", req.params);

            await activateCertificate(req, req.params[0].GUID, req.data.domain);
        });


        async function deactivateCertificate(certGuid, domain, req) {
            const token = await getToken();

            var options = {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            };

            var data = {
                "sans": [
                    domain
                ]
            };

            try {
                var response = await axios.post(`${customDomainApiUrl}/api/v2/servercertificates/${certGuid}/deactivatesans`, data, options);
                req.notify(`Deactivate is in progress for domain ${domain}`);

            } catch (error) {
                var sMsg = error?.response?.data?.error ? error.response.data.error : error?.message;
                req.error(499, sMsg);
            }
        };

        this.on('deactivateCertificate', async (req) => {
            console.log("Deactivate pressed");
            LOG.debug(req.data);
            LOG.debug(req.params);

            const certGuid = req.params[0].GUID;
            const domain = req.data.domain;
            console.log(`Deactivate Certificate with GUID ${certGuid} and domain ${domain}`);

            await deactivateCertificate(certGuid, domain, req);
        });

        async function getToken() {
            /**
             * Extract Token Credentials from Service Binding of Custom Domain Service Instance
             */
            const customDomainService = xsenv.serviceCredentials({ label: 'INFRA' });
            //console.log(customDomainService);

            const data = new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: customDomainService.uaa.clientid,
                client_secret: customDomainService.uaa.clientsecret
            });

            /**
             * Get Token to Access Custom Domain Service API
             */
            var response = await axios.post(customDomainService.uaa.url + "/oauth/token", data);
            const token = response.data.access_token;

            return token;
        };

        /**
         * Extract supported filter values from CAP's OData where-clause expression.
         *
         * Supported fields: domain, status, expired
         * Supported operators: =, ==, in
         *
         * @param {Array|undefined} whereClause SELECT.where expression from req.query
         * @returns {{domain: string[], status: string[], expired: boolean[]}} Normalized filter buckets
         */
        function parseCertificateListFilters(whereClause) {
            const domainValues = new Set();
            const statusValues = new Set();
            const expiredValues = new Set();

            const toPrimitive = (token) => {
                if (token && typeof token === 'object' && Object.prototype.hasOwnProperty.call(token, 'val')) {
                    return token.val;
                }
                return token;
            };

            const toBoolean = (value) => {
                if (typeof value === 'boolean') {
                    return value;
                }
                if (typeof value === 'string') {
                    const normalized = value.toLowerCase();
                    if (normalized === 'true') {
                        return true;
                    }
                    if (normalized === 'false') {
                        return false;
                    }
                }
                return undefined;
            };

            const addFilterValue = (fieldName, rawValue) => {
                if (fieldName === 'domain' && rawValue !== undefined && rawValue !== null) {
                    domainValues.add(String(rawValue));
                }

                if (fieldName === 'status' && rawValue !== undefined && rawValue !== null) {
                    statusValues.add(String(rawValue));
                }

                if (fieldName === 'expired') {
                    const boolValue = toBoolean(rawValue);
                    if (boolValue !== undefined) {
                        expiredValues.add(boolValue);
                    }
                }
            };

            // Recursively walk expression trees, including nested xpr nodes.
            const visit = (expr) => {
                if (!Array.isArray(expr)) {
                    return;
                }

                for (let i = 0; i < expr.length; i++) {
                    const token = expr[i];

                    if (token && typeof token === 'object' && Array.isArray(token.xpr)) {
                        visit(token.xpr);
                        continue;
                    }

                    const left = expr[i];
                    const operator = expr[i + 1];
                    const right = expr[i + 2];

                    if (!left || typeof left !== 'object' || !Array.isArray(left.ref)) {
                        continue;
                    }

                    const fieldName = left.ref[0];
                    if (fieldName !== 'domain' && fieldName !== 'status' && fieldName !== 'expired') {
                        continue;
                    }

                    // Equality filter, e.g. status = 'active'.
                    if (operator === '=' || operator === '==') {
                        addFilterValue(fieldName, toPrimitive(right));
                        i += 2;
                        continue;
                    }

                    // Multi-select filter, e.g. status in ('active','inactive').
                    if (operator === 'in' && right && typeof right === 'object' && Array.isArray(right.list)) {
                        for (const item of right.list) {
                            addFilterValue(fieldName, toPrimitive(item));
                        }
                        i += 2;
                    }
                }
            };

            visit(whereClause);

            return {
                domain: Array.from(domainValues),
                status: Array.from(statusValues),
                expired: Array.from(expiredValues)
            };
        }

        this.on('READ', Domains, async (req) => {
            console.log("READ Domains");
            LOG.debug("Params", req.params);

            const token = await getToken();
            const certificateGuid = req.params[0]?.GUID;

            if (!certificateGuid) {
                req.error(499, "No List read on this Entity");
                return;
            }

            var options = {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            };

            var aResult = [];

            try {
                var response = await axios.get(`${customDomainApiUrl}/api/v2/servercertificates/${certificateGuid}`, options);
                const oCertificate = response.data;

                //console.log("Certificate:");
                //console.log(oCertificate);

                for (var san of oCertificate.metadata.sans) {
                    aResult.push({ alias: san });
                }

            } catch (error) {
                /**
                 * Axios Error Fields
                 */
                //console.log("Error Code: " + error.code);
                //console.log("Error Message: " + error.message);
                //console.log("Error Response: " + error.response.data.error);
                //console.log("Error Status: " + error.response.status);

                try {
                    var response = await axios.get(`${customDomainApiUrl}/api/v2/keys/${certificateGuid}`, options);
                    const oKey = response.data;

                    //console.log("Key:");
                    //console.log(oKey);

                    for (var san of oKey.sans) {
                        aResult.push({ alias: san });
                    }
                } catch (error) {
                    /**
                     * Show Error in Fiori Elements App
                     *   -> See https://cap.cloud.sap/docs/node.js/events#req-msg
                     */
                    req.error({
                        message: error.message + ": " + error.response.data.error,
                        target: "Domains", // connect error to table component
                        status: 404
                    });
                }

            }

            aResult.$count = aResult.length;
            return aResult;

        });

        this.on('READ', CertificateStatuses, async () => {
            return [
                { code: 'active', name: 'Active' },
                { code: 'inactive', name: 'Inactive' },
                { code: 'deactivationInProgress', name: 'Deactivation In Progress' },
                { code: 'csrCreated', name: 'CSR Created' },
                { code: 'csrInProgress', name: 'CSR In Progress' }
            ];
        });

        this.on('READ', Environments, async () => {
            return [
                { code: 'T', name: 'Test' },
                { code: 'P', name: 'Production' }
            ];
        });

        this.on('READ', CertificateDomains, async () => {
            const CatalogService = await cds.connect.to('CatalogService');
            const certificates = await CatalogService.read(Certificates);

            const domainValues = Array.from(
                new Set(
                    certificates
                        .map((cert) => cert.domain)
                        .filter((domain) => typeof domain === 'string' && domain.trim().length > 0)
                )
            ).sort((a, b) => a.localeCompare(b));

            return domainValues.map((domain) => ({
                code: domain,
                name: domain
            }));
        });

        this.on('READ', Certificates, async (req) => {
            // Check if one single certificate is requested by GUID
            const [certificate] = req.params;
            //console.log("Found certificate with GUID " + certificate?.GUID);

            var searchQuery = req._.req?.query?.$search;
            if (searchQuery) {
                searchQuery = searchQuery.split('"').join(''); // remove double quotes
                LOG.debug("Search Query Option: " + searchQuery);
            }

            /*
            // Read the JSON array from the environment variable
            const jsonArray = JSON.parse(process.env.JSON_ARRAY);

            // Ensure it's an array
            if (!Array.isArray(jsonArray)) {
                throw new Error('The environment variable JSON_ARRAY is not a valid JSON array.');
            }
            */

            const token = await getToken();

            var options = {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: {
                    per_page: "all",
                    includecsrs: true
                }
            };

            var cfCertificates = [];

            if (certificate?.GUID) {
                /**
                 * Single Object as Result
                 * Put in try-catch because when no CSR / Certificate yet is generated the single-read URL will respond with 404 not found
                 */
                try {
                    var response = await axios.get(`${customDomainApiUrl}/api/v2/servercertificates/${certificate.GUID}`, options);
                    cfCertificates.push(response.data);
                } catch (error) {
                    // If there is not yet a certificate try to read the key data
                    response = await axios.get(`${customDomainApiUrl}/api/v2/keys/${certificate.GUID}`, options);

                    var aSans = [];
                    for (var san of response.data.sans) {
                        aSans.push(san);
                    }

                    var dummyCert = [{
                        GUID: certificate.GUID,
                        code: 'C',
                        alias: response.data.alias,
                        domain: aSans.length === 1 ? aSans[0] : "*" + aSans.length + " Domains",
                        status: response.data.status,
                        date_begin: null,
                        date_end: null,
                        expiration_severity: 0,
                        expiration_days: 0,
                        expiration_percent: 0,
                        expired: false,

                        isRecreatable: aSans.length == 1 ? true : false,
                        isCertificateCreateable: response.data.status === "csrCreated" ? true : false,
                        isActivateable: response.data.status === "inactive" ? true : false,
                        isDeactivateable: response.data.status === "active" ? true : false,

                        route_path: aSans.length == 1 ? `https://${aSans[0]}/.well-known/acme-challenge/test.txt` : "",

                        isDeleteable: response.data.status === "inactive" || response.data.status === "csrCreated" ? true : false,
                        criticality: calculateCriticality(response.data.expiration_info?.severity, response.data.status),

                        hasOnlyOneDomainSAN: aSans.length === 1 ? true : false,

                        landscape: response.data.landscape
                    }];

                    dummyCert.$count = dummyCert.length; // important otherwise Fiori Elements does not show anything !!

                    return dummyCert;
                }

            } else {
                /**
                 * Array as Result
                 */
                var response = await axios.get(`${customDomainApiUrl}/api/v2/servercertificates`, options);
                cfCertificates = response.data.resources;
            }

            console.log("Number of Certificates: " + cfCertificates.length);
            //console.log("CF Certificates:", cfCertificates);

            var certificates = [];
            for (var cfCert of cfCertificates) {
                if (searchQuery && !cfCert.alias.includes(searchQuery)) {
                    continue; // skip if search string not found
                }

                var aSans = [];
                for (var san of cfCert.metadata.sans) {
                    aSans.push(san);
                }

                certificates.push({
                    GUID: cfCert.guid,
                    code: 'C',
                    alias: cfCert.alias,
                    domain: aSans.length === 1 ? aSans[0] : "*" + aSans.length + " Domains",
                    status: cfCert.status,
                    date_begin: cfCert.metadata.not_before,
                    date_end: cfCert.metadata.not_after,
                    expiration_severity: cfCert.expiration_info?.severity,
                    expiration_days: cfCert.expiration_info?.days_remaining,
                    expiration_percent: cfCert.expiration_info?.percent_lifetime,
                    expired: cfCert.expiration_info?.expired,

                    isRecreatable: aSans.length == 1 ? true : false,
                    isCertificateCreateable: cfCert.status === "csrCreated" ? true : false,
                    isActivateable: cfCert.status === "inactive" && cfCert.expiration_info?.expired === false ? true : false,
                    isDeactivateable: cfCert.status === "active" ? true : false,

                    route_path: aSans.length == 1 ? `https://${aSans[0]}/.well-known/acme-challenge/test.txt` : "",

                    isDeleteable: cfCert.status === "inactive" || cfCert.status === "csrCreated" ? true : false,
                    criticality: calculateCriticality(cfCert.expiration_info?.severity, cfCert.status),

                    hasOnlyOneDomainSAN: aSans.length === 1 ? true : false,

                    landscape: cfCert.landscape
                });
            }

            const whereClause = req.query?.SELECT?.where;
            const filters = parseCertificateListFilters(whereClause);

            if (filters.domain.length > 0 || filters.status.length > 0 || filters.expired.length > 0) {
                certificates = certificates.filter((cert) => {
                    const domainMatches = filters.domain.length === 0 || filters.domain.includes(cert.domain);
                    const statusMatches = filters.status.length === 0 || filters.status.includes(cert.status);
                    const expiredMatches = filters.expired.length === 0 || filters.expired.includes(cert.expired);
                    return domainMatches && statusMatches && expiredMatches;
                });
            }

            certificates.sort((left, right) => {
                const leftDate = left.date_end ? Date.parse(left.date_end) : Number.NEGATIVE_INFINITY;
                const rightDate = right.date_end ? Date.parse(right.date_end) : Number.NEGATIVE_INFINITY;
                return rightDate - leftDate;
            });

            //console.log(certificates);
            certificates.$count = certificates.length; // important otherwise Fiori Elements does not show anything !!

            return certificates;

        });

        this.on('DELETE', Certificates, async (req) => {
            console.log("Delete pressed");
            LOG.debug("Params", req.params);

            const certGuid = req.params[0].GUID;

            LOG.debug("Delete Certificate with GUID", certGuid);

            try {
                const result = await deleteCertificateByGuid(certGuid);
                req.notify(result.deletedType === "key" ? "Key Deleted" : "Certificate Deleted");
            } catch (error) {
                var sMsg = error.response?.data?.error ? error.response.data.error : error.message;
                req.error(499, sMsg);
            }
        });


        this.on('READ', Routes, async (req) => {
            console.log("Read Routes");

            const certificateGuid = req.params[0]?.GUID;
            LOG.debug(`Certificate: ${certificateGuid}`);

            var aResult = [];

            /**
             * Get Token to Access Custom Domain Service API
             */
            try {
                const custom_domain_token = await getToken();
                var options = {
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    params: {
                        per_page: "all"
                    }
                };

                /**
                 * Read Landscape Information from UserInfo Endpoint (Binding specific)
                 */
                response = await axios.get(`${customDomainApiUrl}/api/v2/userinfo`, options);
                LOG.debug('UserInfo is', response.data);

                // Extract CF Landscape using descruction syntax
                const { tenant_environments: [{ cf_landscape }] } = response.data;
                LOG.debug('CF Landscape:', cf_landscape);

                // Remove "cf-" from cf_landscape variable
                const landscape = cf_landscape.replace("cf-", "");

                const token = await getCfApiBearerToken(landscape);

                /**
                 * Get Routes in Shared - Domains
                 */
                LOG.debug("VCAP_APPLICATION", process.env.VCAP_APPLICATION);
                const VCAP_APPLICATION = JSON.parse(process.env.VCAP_APPLICATION);

                const response = await axios.get(`https://api.cf.${landscape}.hana.ondemand.com/v3/routes?space_guids=${VCAP_APPLICATION.cfSpace}`, options);
                const routes = response.data.resources;
                LOG.debug("Found routes", routes);

                for (var oRoute of routes) {
                    if (oRoute.path === "/.well-known/acme-challenge/") {
                        var domainName = "";
                        if (oRoute.links?.domain?.href) {
                            var domainResponse = await axios.get(oRoute.links.domain.href, options);
                            // console.log(domainResponse.data);
                            domainName = domainResponse.data.name;
                        }

                        var bindedApplicationGuid = oRoute?.destinations[0]?.app?.guid;
                        var bindedApplicationName = "";
                        if (bindedApplicationGuid) {
                            var appResponse = await axios.get(`https://api.cf.${landscape}.hana.ondemand.com/v3/apps/${bindedApplicationGuid}`, options);
                            // console.log(appResponse.data);
                            bindedApplicationName = appResponse.data.name;
                        }

                        aResult.push({
                            guid: oRoute.guid,
                            domain: domainName,
                            path: oRoute.path,
                            url: `https://${oRoute.url}`,
                            application: bindedApplicationName,
                            isRouteComplete: domainName.trim().length > 0 && bindedApplicationName === VCAP_APPLICATION.application_name, 
                            space_guid: oRoute.relationships.space.data.guid,
                            domain_guid: oRoute.relationships.domain.data.guid
                        });
                    }
                }

                aResult.$count = aResult.length;
                return aResult;

            } catch (error) {
                console.log(error.message);
                console.log(error.response?.data);
            }

        });



        async function checkRoute(domain, req) {
            /**
             * Check if route exists
             */
            //const domain = req.data.domain;
            const acmeCheckUrl = `https://${domain}/.well-known/acme-challenge/test.txt`;

            // Ignore SSL-Validation (necessary for completely new domains which do not have a valid certificate in beginning)
            const agent = new https.Agent({
                rejectUnauthorized: false
            });

            try {
                console.log(`Check if ACME URL is reachable (route existing): ${acmeCheckUrl}`);
                const result = await axios.get(acmeCheckUrl, { httpsAgent: agent });
                const checkResult = result.data;
                LOG.debug("Check Route result", checkResult);

                if (checkResult === "Test successful") {
                    req.notify(`Route gefunden für Domain ${domain}`);
                } else {
                    throw new Error(`Route nicht gefunden für Domain ${domain}`);
                }

            } catch (error) {
                throw new Error(`Route nicht gefunden für Domain ${domain}`);
            }
        };


        async function getCfApiBearerToken(landscape) {
            /**
             * This user has been created on IAS System then:
             *   1) Add as a User to the CF Subaccount "User List"
             *   2) Add as Org Member
             *   3) Add as a Space Developer
             */


            /**
             * Extract Custom Domain Service API URL from binded service
             */
            const sDestinationName = 'cf_api';

            const destinationService = xsenv.serviceCredentials({ label: 'destination' });
            LOG.debug("Destination Service", destinationService);
            
            const sUaaCredentials = destinationService.clientid + ':' + destinationService.clientsecret;
            

            /**
             * Authenticate to the Destination Service
             */
            const post_payload = {
                'client_id': destinationService.clientid,
                'grant_type': 'client_credentials'
            };

            const post_config = {
                method: 'POST',
                url: destinationService.url + '/oauth/token',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(sUaaCredentials).toString('base64'),
                    'Content-type': 'application/x-www-form-urlencoded'
                },
                data: new URLSearchParams(post_payload).toString() // Encode the payload as x-www-form-urlencoded
            };

            let response = await axios(post_config);
            LOG.debug("Destination Service Authentication Status", response.status);
            LOG.debug("Destination Service Authentication Data", response.data);

            if (response.status !== 200) {
                throw new Error('Failed to authenticate to the destination service');
            }

            var token = response.data.access_token;

            /**
             * Read CF-API Destination Configuration
             */
            const get_config = {
                method: 'GET',
                url: destinationService.uri + '/destination-configuration/v1/destinations/' + sDestinationName,
                headers: {
                    'Authorization': 'Bearer ' + token
                }
            };

            response = await axios(get_config);
            LOG.debug("Destination Service Status", response.status);
            LOG.debug("Destination Service Data", response.data);

            const { destinationConfiguration } = response.data;

            const cfApiAuthData = new URLSearchParams({
                grant_type: 'password',
                response_type: "token",
                login_hint: `{"origin":"${destinationConfiguration.origin}"}`,
                username: destinationConfiguration.User,
                password: destinationConfiguration.Password
            });

            const encodedToken = Buffer.from(`${destinationConfiguration.clientId}:${destinationConfiguration.clientSecret}`).toString('base64');
            const headers = { 'Authorization': 'Basic ' + encodedToken };

            response = await axios.post(`https://login.cf.${landscape}.hana.ondemand.com/oauth/token`, cfApiAuthData, { headers });
            token = response.data.access_token;

            LOG.debug("Fetched CF API token", token);
            return token;

        };


        function calculateCriticality(sSeverity, sStatus) {
            if (sStatus === "active") {
                switch (sSeverity) {
                    case "critical":
                        return 1; // red
                    case "high":
                        return 2; // yellow
                    case "none":
                        return 3; // green
                    default:
                        return 0; // grey
                }
            } else {
                return 0; // default
            }

        };


        /**
         * Function used to satisfy an ACME challenge
         *
         * @param {object} authz Authorization object
         * @param {object} challenge Selected challenge
         * @param {string} keyAuthorization Authorization key
         * @returns {Promise}
         */

        async function challengeCreateFn(authz, challenge, keyAuthorization) {
            console.log('Triggered challengeCreateFn()');

            /* http-01 */
            if (challenge.type === 'http-01') {
                //const filePath = __dirname + '/static' + `/.well-known/acme-challenge/${challenge.token}`;
                const filePath = challengeFolderPath + challenge.token;
                const fileContents = keyAuthorization;

                LOG.debug(`Creating challenge response for ${authz.identifier.value} at path: ${filePath}`);

                /* Replace this */
                LOG.debug(`Write "${fileContents}" to path "${filePath}"`);

                try {
                    fs.writeFileSync(filePath, fileContents);
                } catch (err) {
                    console.error(err);
                }
            }
        };

        /**
         * Function used to remove an ACME challenge response
         *
         * @param {object} authz Authorization object
         * @param {object} challenge Selected challenge
         * @param {string} keyAuthorization Authorization key
         * @returns {Promise}
         */

        async function challengeRemoveFn(authz, challenge, keyAuthorization) {
            console.log('Triggered challengeRemoveFn()');

            /* http-01 */
            if (challenge.type === 'http-01') {
                //const filePath = __dirname + '/static' + `/.well-known/acme-challenge/${challenge.token}`;
                const filePath = challengeFolderPath + challenge.token;

                LOG.debug(`Removing challenge response for ${authz.identifier.value} at path: ${filePath}`);

                LOG.debug(`Remove file on path "${filePath}"`);

                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    console.error(err);
                }
            }
        };

        /**
         * Function used to split Certificate Chain from Let's Encrypt to array containing three separate certificates
         * @param {String} sCertificateChain 
         * @returns {Array}
         */
        function splitCertificateChain(sCertificateChain) {
            var ca = [];
            var chain = sCertificateChain;

            if (chain.indexOf("-END CERTIFICATE-") < 0 || chain.indexOf("-BEGIN CERTIFICATE-") < 0) {
                throw Error("File does not contain 'BEGIN CERTIFICATE' or 'END CERTIFICATE'");
            }

            chain = chain.split(EOL);
            var cert = [];

            for (var _i = 0, _len = chain.length; _i < _len; _i++) {
                var line = chain[_i];
                if (!(line.length !== 0)) {
                    continue;
                }
                cert.push(line);
                if (line.match(/-END CERTIFICATE-/)) {
                    ca.push(cert.join(EOL));
                    cert = [];
                }
            }
            return ca;
        };



        /**
         * Recreate a new Certificate based from existing and activate it
         * @param {*} req CAP Request object used to return messages and errors
         * @param {*} domain Domain of the certificate
         * @param {*} alias Alias of the certificate
         * @param {*} code Environment Code (P = Production, T = Test)
         * @returns 
         */
        async function renewAndActivateCertificate(req, domain, alias, code) {
            /**
             * Create a new Certificate Signing Request (CSR)
             */
            const newKey = await recreateCsrFromExisting(req, domain, alias);
            const [{ GUID: newCertGuid }] = newKey;
            LOG.debug("New Key for CSR created", newCertGuid);

            const token = await getToken();

            var options = {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: {
                    per_page: "all",
                    includecsrs: true
                }
            };

            let sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

            for (let step = 0; step < 10; step++) {
                await sleep(2000);

                let response = await axios.get(`${customDomainApiUrl}/api/v2/keys/${newCertGuid}`, options);
                var status = response.data.status;

                LOG.debug("Response Status", status);

                if (status !== "csrInProgress") {
                    break;
                }
            }

            LOG.debug("End Status", status);

            if (status !== "csrCreated") {
                req.error(499, "CSR creation failed. Check logs.");
                return;
            }

            await createCertificateFromCSRKey(req, newCertGuid, domain, alias, code);

            LOG.debug("Env-Code: " + code);
            if (code !== 'P') {
                req.notify("Test Mode successful");
                return;
            }

            await activateCertificate(req, newCertGuid, domain);
        };


        async function deleteCertificateByGuid(certGuid) {
            const token = await getToken();
            var options = {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            };

            try {
                await axios.delete(`${customDomainApiUrl}/api/v2/keys/${certGuid}`, options);
                return { deletedType: "key" };
            } catch (keyDeleteError) {
                try {
                    await axios.delete(`${customDomainApiUrl}/api/v2/servercertificates/${certGuid}`, options);
                    return { deletedType: "servercertificate" };
                } catch (certDeleteError) {
                    throw certDeleteError;
                }
            }
        }

        function getJobSchedulerCredentials() {
            const vcapServices = JSON.parse(process.env.VCAP_SERVICES || '{}');
            const credentials = vcapServices.jobscheduler?.[0]?.credentials;

            if (!credentials) {
                throw new Error('Job Scheduler service credentials not found in VCAP_SERVICES');
            }

            const schedulerUrl = `${credentials.url}/scheduler`;
            const uaaUrl = credentials.uaa?.url;
            const clientId = credentials.uaa?.clientid;
            const clientSecret = credentials.uaa?.clientsecret;

            if (!schedulerUrl || !uaaUrl || !clientId || !clientSecret) {
                throw new Error('Incomplete Job Scheduler credentials: expected url, uaa.url, uaa.clientid, uaa.clientsecret');
            }

            return {
                schedulerApiUrl: schedulerUrl,
                uaaUrl,
                clientId,
                clientSecret
            };
        }

        async function getJobSchedulerAccessToken(oauthCredentials) {
            const { uaaUrl, clientId, clientSecret } = oauthCredentials;
            const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            const payload = new URLSearchParams({
                grant_type: 'client_credentials'
            }).toString();

            try {
                const response = await axios.post(`${uaaUrl}/oauth/token`, payload, {
                    headers: {
                        'Authorization': `Basic ${authString}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });

                return {
                    accessToken: response.data.access_token,
                    tokenUrl: `${uaaUrl}/oauth/token`
                };
            } catch (error) {
                const status = error?.response?.status;
                const message = error?.response?.data?.error_description || error?.response?.data?.error || error.message;
                LOG.debug('getJobSchedulerAccessToken error', {
                    tokenUrl: `${uaaUrl}/oauth/token`,
                    status,
                    message,
                    response: error?.response?.data
                });
                throw new Error(`Unable to fetch Job Scheduler access token from ${uaaUrl}/oauth/token: ${status || 'n/a'} ${message}`);
            }
        }

        const SCHEDULER_WEEKLY_SCHEDULE_NAME = 'Weekly';
        const SCHEDULER_JOB_DEFINITIONS = [
            {
                name: 'Renew Active Certificates',
                description: "Renew Active Certificates using Let's Encrypt",
                actionPath: '/catalog/renewCertificates'
            },
            {
                name: 'Delete Expired Certificates',
                description: 'Delete expired certificates that have a valid replacement',
                actionPath: '/catalog/deleteExpiredCertificates'
            }
        ];

        // Local development note:
        // When running on localhost, set VCAP_APPLICATION with application_uris, e.g.
        // {"application_uris":["my-app.cfapps.eu10.hana.ondemand.com"]}
        function getServiceBaseUrl(req) {
            const vcapApplication = process.env.VCAP_APPLICATION ? JSON.parse(process.env.VCAP_APPLICATION) : null;
            const defaultAppUri = vcapApplication?.application_uris?.[0];
            if (defaultAppUri) {
                return `https://${defaultAppUri}`;
            }

            const forwardedHost = req?.headers?.['x-forwarded-host']?.split(',')?.[0]?.trim();
            const host = forwardedHost || req?.headers?.host;
            if (host && !host.startsWith('localhost')) {
                return `https://${host}`;
            }

            throw new Error('Unable to determine service base URL. Local localhost run detected: set VCAP_APPLICATION with application_uris[0], for example {"application_uris":["my-app.cfapps.eu10.hana.ondemand.com"]}.');
        }

        async function loadSchedulerJobSchedules(jobId, schedulerApiUrl, axiosConfig) {
            const schedulesResponse = await axios.get(`${schedulerApiUrl}/jobs/${jobId}/schedules`, {
                ...axiosConfig,
                params: {
                    page_size: 200,
                    offset: 0
                }
            });

            return Array.isArray(schedulesResponse.data?.results)
                ? schedulesResponse.data.results
                : [];
        }

        async function findSchedulerJobByName(jobName, schedulerApiUrl, axiosConfig) {
            const jobsResponse = await axios.get(`${schedulerApiUrl}/jobs`, {
                ...axiosConfig,
                params: {
                    filter: `name eq '${jobName}'`,
                    page_size: 200,
                    offset: 0
                }
            });

            const jobs = Array.isArray(jobsResponse.data?.results) ? jobsResponse.data.results : [];
            return jobs.find((job) => job?.name === jobName) || null;
        }

        /**
         * API Documentation: https://api.sap.com/api/sap-btpjss-admin-v1/overview
         */
        this.on('checkRenewCertificatesScheduler', async (req) => {
            try {
                const schedulerCredentials = getJobSchedulerCredentials();
                const schedulerApiUrl = schedulerCredentials.schedulerApiUrl;
                const tokenInfo = await getJobSchedulerAccessToken(schedulerCredentials);
                const schedulerToken = tokenInfo.accessToken;
                LOG.debug('Scheduler check start', {
                    schedulerApiUrl,
                    tokenUrl: tokenInfo.tokenUrl,
                    hasToken: !!schedulerToken
                });

                const axiosConfig = {
                    headers: {
                        Authorization: `Bearer ${schedulerToken}`
                    }
                };

                const results = [];
                for (const jobDefinition of SCHEDULER_JOB_DEFINITIONS) {
                    const targetJob = await findSchedulerJobByName(jobDefinition.name, schedulerApiUrl, axiosConfig);

                    if (!targetJob) {
                        results.push({
                            jobName: jobDefinition.name,
                            jobFound: false,
                            jobActive: false,
                            scheduleName: SCHEDULER_WEEKLY_SCHEDULE_NAME,
                            scheduleFound: false,
                            scheduleActive: false,
                            jobId: null
                        });
                        continue;
                    }

                    const schedules = await loadSchedulerJobSchedules(targetJob.jobId, schedulerApiUrl, axiosConfig);

                    const weeklySchedule = schedules.find((schedule) =>
                        schedule?.description === SCHEDULER_WEEKLY_SCHEDULE_NAME
                    );

                    results.push({
                        jobName: jobDefinition.name,
                        jobFound: true,
                        jobActive: targetJob.active === true,
                        scheduleName: SCHEDULER_WEEKLY_SCHEDULE_NAME,
                        scheduleFound: !!weeklySchedule,
                        scheduleActive: weeklySchedule?.active === true,
                        jobId: targetJob.jobId
                    });
                }

                const allHealthy = results.every((entry) =>
                    entry.jobFound && entry.jobActive && entry.scheduleFound && entry.scheduleActive
                );

                if (allHealthy) {
                    req.notify('Scheduler check successful: all scheduler jobs and weekly schedules are active');
                } else {
                    const issues = [];
                    for (const entry of results) {
                        if (!entry.jobFound) issues.push(`job "${entry.jobName}" not found`);
                        else if (!entry.jobActive) issues.push(`job "${entry.jobName}" not active`);
                        if (entry.jobFound && !entry.scheduleFound) issues.push(`weekly schedule missing for "${entry.jobName}"`);
                        else if (entry.scheduleFound && !entry.scheduleActive) issues.push(`weekly schedule inactive for "${entry.jobName}"`);
                    }
                    req.warn(`Scheduler check failed: ${issues.join(', ')}`);
                }

                return JSON.stringify({
                    scheduleName: SCHEDULER_WEEKLY_SCHEDULE_NAME,
                    allHealthy,
                    jobs: results
                });
            } catch (error) {
                const status = error?.response?.status;
                const message = error?.response?.data?.message || error?.response?.data?.error || error.message;
                LOG.debug('Scheduler check error', {
                    status,
                    message,
                    response: error?.response?.data
                });
                if (status === 401 || status === 403) {
                    req.error(499, `Scheduler check unauthorized (${status}). Verify jobscheduler key scopes and token audience. Details: ${message}`);
                    return;
                }

                req.error(499, `Scheduler check failed: ${message}`);
                return;
            }
        });

        async function setRenewSchedulesActivationStatus(activationStatus, req) {
            const schedulerCredentials = getJobSchedulerCredentials();
            const schedulerApiUrl = schedulerCredentials.schedulerApiUrl;
            const tokenInfo = await getJobSchedulerAccessToken(schedulerCredentials);
            const schedulerToken = tokenInfo.accessToken;

            const axiosConfig = {
                headers: {
                    Authorization: `Bearer ${schedulerToken}`
                }
            };

            const results = [];
            for (const jobDefinition of SCHEDULER_JOB_DEFINITIONS) {
                const targetJob = await findSchedulerJobByName(jobDefinition.name, schedulerApiUrl, axiosConfig);

                if (!targetJob) {
                    results.push({
                        jobName: jobDefinition.name,
                        jobFound: false,
                        schedulesEnabled: false,
                        jobId: null
                    });
                    continue;
                }

                //const jobId = getSchedulerJobId(targetJob);
                if (targetJob?.jobId === undefined || targetJob?.jobId === null) {
                    throw new Error(`Could not determine ID for job "${jobDefinition.name}"`);
                }

                await axios.post(
                    `${schedulerApiUrl}/jobs/${targetJob.jobId}/schedules/activationStatus`,
                    { activationStatus },
                    axiosConfig
                );

                results.push({
                    jobName: jobDefinition.name,
                    jobFound: true,
                    schedulesEnabled: activationStatus,
                    jobId: targetJob.jobId
                });
            }

            return JSON.stringify({
                activationStatus,
                jobs: results
            });
        }

        this.on('enableRenewCertificatesScheduler', async (req) => {
            try {
                const result = await setRenewSchedulesActivationStatus(true, req);
                req.notify('Scheduler updated: weekly schedules enabled for all configured jobs');
                return result;
            } catch (error) {
                const status = error?.response?.status;
                const message = error?.response?.data?.message || error?.response?.data?.error || error.message;
                req.error(499, `Enable scheduler failed: ${status ? `${status} ` : ''}${message}`);
            }
        });

        this.on('disableRenewCertificatesScheduler', async (req) => {
            try {
                const result = await setRenewSchedulesActivationStatus(false, req);
                req.notify('Scheduler updated: weekly schedules disabled for all configured jobs');
                return result;
            } catch (error) {
                const status = error?.response?.status;
                const message = error?.response?.data?.message || error?.response?.data?.error || error.message;
                req.error(499, `Disable scheduler failed: ${status ? `${status} ` : ''}${message}`);
            }
        });

        this.on('createRenewCertificatesScheduler', async (req) => {
            const currentUtcStartTime = new Date().toISOString();

            try {
                const actionBaseUrl = getServiceBaseUrl(req);
                const schedulerCredentials = getJobSchedulerCredentials();
                const schedulerApiUrl = schedulerCredentials.schedulerApiUrl;
                const tokenInfo = await getJobSchedulerAccessToken(schedulerCredentials);
                const schedulerToken = tokenInfo.accessToken;

                const axiosConfig = {
                    headers: {
                        Authorization: `Bearer ${schedulerToken}`
                    }
                };

                const results = [];
                for (const jobDefinition of SCHEDULER_JOB_DEFINITIONS) {
                    const createSchedulePayload = {
                        description: SCHEDULER_WEEKLY_SCHEDULE_NAME,
                        active: true,
                        repeatInterval: '1 week',
                        startTime: currentUtcStartTime
                    };

                    const createJobPayload = {
                        name: jobDefinition.name,
                        description: jobDefinition.description,
                        action: `${actionBaseUrl.replace(/\/+$/, '')}${jobDefinition.actionPath}`,
                        active: true,
                        httpMethod: 'GET',
                        calmConfig: {
                            enabled: true
                        },
                        endTime: null,
                        schedules: [createSchedulePayload]
                    };

                    try {
                        const createJobResponse = await axios.post(
                            `${schedulerApiUrl}/jobs`,
                            createJobPayload,
                            axiosConfig
                        );

                        const createdJob = createJobResponse.data || {};
                        const jobId = createdJob?._id ?? null;
                        const createdSchedule = Array.isArray(createdJob.schedules) ? createdJob.schedules[0] : null;
                        const scheduleId = createdSchedule?.scheduleId || null;

                        results.push({
                            jobName: jobDefinition.name,
                            jobId: jobId ?? null,
                            scheduleName: SCHEDULER_WEEKLY_SCHEDULE_NAME,
                            scheduleId,
                            jobCreated: true,
                            scheduleCreated: true
                        });
                    } catch (createError) {
                        results.push({
                            jobName: jobDefinition.name,
                            jobId: null,
                            scheduleName: SCHEDULER_WEEKLY_SCHEDULE_NAME,
                            scheduleId: null,
                            jobCreated: false,
                            scheduleCreated: false,
                            status: createError?.response?.status || null,
                            error: createError?.response?.data?.message || createError?.response?.data?.error || createError.message
                        });
                    }
                }

                const createdCount = results.filter((entry) => entry.jobCreated).length;
                if (createdCount === SCHEDULER_JOB_DEFINITIONS.length) {
                    req.notify('Scheduler created: both jobs and weekly schedules were created');
                } else if (createdCount > 0) {
                    req.warn('Scheduler creation partially successful: some jobs could not be created');
                } else {
                    const errorSummary = results.map((entry) => `${entry.jobName}: ${entry.error || 'unknown error'}`).join('; ');
                    req.error(499, `Create scheduler failed for all jobs: ${errorSummary}`);
                    return;
                }

                return JSON.stringify({
                    scheduleName: SCHEDULER_WEEKLY_SCHEDULE_NAME,
                    actionBaseUrl,
                    jobs: results
                });
            } catch (error) {
                const status = error?.response?.status;
                const message = error?.response?.data?.message || error?.response?.data?.error || error.message;
                LOG.debug('Create scheduler error', {
                    status,
                    message,
                    response: error?.response?.data
                });
                req.error(499, `Create scheduler failed: ${status ? `${status} ` : ''}${message}`);
            }
        });

        this.on('deleteRenewCertificatesScheduler', async (req) => {
            try {
                const schedulerCredentials = getJobSchedulerCredentials();
                const schedulerApiUrl = schedulerCredentials.schedulerApiUrl;
                const tokenInfo = await getJobSchedulerAccessToken(schedulerCredentials);
                const schedulerToken = tokenInfo.accessToken;

                const axiosConfig = {
                    headers: {
                        Authorization: `Bearer ${schedulerToken}`
                    }
                };

                const results = [];
                for (const jobDefinition of SCHEDULER_JOB_DEFINITIONS) {
                    const targetJob = await findSchedulerJobByName(jobDefinition.name, schedulerApiUrl, axiosConfig);
                    if (!targetJob) {
                        results.push({
                            jobName: jobDefinition.name,
                            jobFound: false,
                            jobDeleted: false,
                            jobId: null
                        });
                        continue;
                    }

                    await axios.delete(`${schedulerApiUrl}/jobs/${targetJob.jobId}`, axiosConfig);
                    results.push({
                        jobName: jobDefinition.name,
                        jobFound: true,
                        jobDeleted: true,
                        jobId: targetJob.jobId
                    });
                }

                const deletedCount = results.filter((entry) => entry.jobDeleted).length;
                if (deletedCount > 0) {
                    req.notify(`Scheduler deleted: ${deletedCount} job(s) removed`);
                } else {
                    req.warn('No scheduler jobs deleted because none were found');
                }

                return JSON.stringify({ jobs: results });
            } catch (error) {
                const status = error?.response?.status;
                const message = error?.response?.data?.message || error?.response?.data?.error || error.message;
                LOG.debug('Delete scheduler error', {
                    status,
                    message,
                    response: error?.response?.data
                });
                req.error(499, `Delete scheduler failed: ${status ? `${status} ` : ''}${message}`);
            }
        });


        /**
         * Test with GET http://localhost:4004/catalog/renewCertificates(test=true)
         */
        this.on('renewCertificates', async (req) => {
            LOG.debug('Renew Certificates by Scheduler Function');
            LOG.debug('req.data', JSON.stringify(req.data));
            LOG.debug('req.params', JSON.stringify(req.params));
    
            LOG.debug('Request headers', req.headers);
    
            // Check for Test-Mode
            const test = req.data?.test === true;
            LOG.debug('Testmode?', test);
    

            /**
             * Store scheduler data in order to send asynchronous reponse later when background job has finished
             */
            const schedulerJobId = req.headers['x-sap-job-id'];
            const schedulerScheduleId = req.headers['x-sap-job-schedule-id'];
            const schedulerRunId = req.headers['x-sap-job-run-id'];
            const schedulerHost = req.headers['x-sap-scheduler-host'];
    
            if (schedulerJobId) {
                var btpSchedulerCredentials = JSON.parse(process.env.VCAP_SERVICES).jobscheduler[0].credentials;
                var authString = Buffer.from(`${btpSchedulerCredentials.uaa.clientid}:${btpSchedulerCredentials.uaa.clientsecret}`).toString('base64');
            }
            
    
            /**
             * Now get all HDI Containers which have the scheduler-flag set to 'true'
             */
            const CatalogService = await cds.connect.to('CatalogService');
            const { Certificates } = CatalogService.entities;

            // Filter only active certificates (not possible in READ-Request because request is served from SRV and not from DB)
            const certificates = (await CatalogService.read(Certificates)).filter(cert => cert.status === 'active');
            LOG.debug('Active Certificates', certificates);
            
            certificates.map(async (cert) => {
                // Generate a new alias name containing a timestamp, for example "test_20241002_0807"
                cert.alias = cert.alias.split('_')[0] + '_' + new Date().toISOString().replace(/[-:.]/g, '').replace('T', '_').substring(0, 13);
                LOG.debug('New Alias', cert.alias);
            });


    
    
            if (test) {
                /**
                 * Test-Mode: Do not process request in background
                 */
                for (const cert of certificates) {
                    LOG.debug('Renew Certificate', cert);
                    await renewAndActivateCertificate(req, cert.domain, cert.alias, 'T');
                }    

            } else {
                if (schedulerJobId) {
                    /**
                     * BTP Scheduler Timeout after 15 seconds.. Therefore process request in background and send an async response to the BTP Scheduler.
                     * See https://community.sap.com/t5/technology-blogs-by-sap/using-job-scheduler-in-sap-cloud-platform-5-long-running-async-jobs/ba-p/13451049
                     */
                    cds.spawn(async () => {
                        LOG.debug("CDS Spawn");

                        // Get access token for BTP Scheduler instance
                        const response = await axios.get(`${btpSchedulerCredentials.uaa.url}/oauth/token?grant_type=client_credentials&response_type=token`, {
                            headers: {
                                'Authorization': `Basic ${authString}`
                            }
                        });

                        const token = response.data.access_token;

                        const axiosConfig = {
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: 'Bearer ' + token
                        }
                        };

                        const schedulerUrl = `${schedulerHost}/scheduler/jobs/${schedulerJobId}/schedules/${schedulerScheduleId}/runs/${schedulerRunId}`;

                        try {
                            /**
                             * Renew all certificates in background
                             */
                            for (const cert of certificates) {
                                LOG.debug('Renew Certificate', cert);
                                await renewAndActivateCertificate(req, cert.domain, cert.alias, 'P');
                            } 

                            LOG.debug('All active certificates renewed');

                            // Async response to scheduler instance
                            axios.put(schedulerUrl, JSON.stringify({success: true, message: `Certificates renewed: ${JSON.stringify(certificates)}`}), axiosConfig);

                        } catch (error) {
                            console.error('Error renewing certificates', error);

                            // Async response to scheduler instance
                            axios.put(schedulerUrl, JSON.stringify({success: false, message: `Error "${JSON.stringify(error)}" renewing certificates: ${certificates}`}), axiosConfig);
                        }

                    });

                    /**
                     * Async Scheduler should receive HTTP Status 202 to show proper status "RUNNING/ACK_RECVD".
                     * When background job has finished, a final status will be sent asynchronously.
                     */
                    let { res } = req.http;
                    res.status(202).send('Accepted async job, but long-running operation still running.');

                } else {
                    /**
                     * Normal Mode: Process request in foreground
                     */
                    for (const cert of certificates) {
                        LOG.debug('Renew Certificate', cert);
                        await renewAndActivateCertificate(req, cert.domain, cert.alias, 'P');
                    }  
                }
                
            }
        });


        /**
         * Delete expired certificates if at least one certificate with same domain is still valid.
         * Test with GET http://localhost:4004/catalog/deleteExpiredCertificates(test=true)
         */
        this.on('deleteExpiredCertificates', async (req) => {
            LOG.debug('Delete expired certificates by scheduler function');
            LOG.debug('req.data', JSON.stringify(req.data));
            LOG.debug('req.params', JSON.stringify(req.params));
            LOG.debug('Request headers', req.headers);

            const test = req.data?.test === true;
            LOG.debug('Testmode?', test);

            const schedulerJobId = req.headers['x-sap-job-id'];
            const schedulerScheduleId = req.headers['x-sap-job-schedule-id'];
            const schedulerRunId = req.headers['x-sap-job-run-id'];
            const schedulerHost = req.headers['x-sap-scheduler-host'];

            let btpSchedulerCredentials;
            let authString;
            if (schedulerJobId) {
                btpSchedulerCredentials = JSON.parse(process.env.VCAP_SERVICES).jobscheduler[0].credentials;
                authString = Buffer.from(`${btpSchedulerCredentials.uaa.clientid}:${btpSchedulerCredentials.uaa.clientsecret}`).toString('base64');
            }

            const CatalogService = await cds.connect.to('CatalogService');
            const { Certificates } = CatalogService.entities;

            async function processDeleteExpiredCertificates() {
                const certificates = await CatalogService.read(Certificates);
                LOG.debug('All Certificates', certificates);

                const deletableStatuses = new Set(['inactive', 'csrCreated']);

                const validDomains = new Set(
                    certificates
                        .filter(cert => cert.domain && cert.expired === false && cert.status === 'active')
                        .map(cert => cert.domain)
                );

                const candidates = certificates.filter(
                    cert => cert.expired === true && cert.domain && validDomains.has(cert.domain) && deletableStatuses.has(cert.status)
                );
                const deletedCertificates = [];
                const skippedCertificates = [];

                // Report certificates that are intentionally not processed by business rules.
                for (const cert of certificates) {
                    if (!cert.domain) {
                        skippedCertificates.push({
                            GUID: cert.GUID,
                            alias: cert.alias,
                            domain: cert.domain,
                            reason: 'missing_domain'
                        });
                        continue;
                    }

                    if (cert.expired !== true) {
                        skippedCertificates.push({
                            GUID: cert.GUID,
                            alias: cert.alias,
                            domain: cert.domain,
                            reason: 'not_expired'
                        });
                        continue;
                    }

                    if (!deletableStatuses.has(cert.status)) {
                        skippedCertificates.push({
                            GUID: cert.GUID,
                            alias: cert.alias,
                            domain: cert.domain,
                            status: cert.status,
                            reason: 'status_not_deletable'
                        });
                        continue;
                    }

                    if (!validDomains.has(cert.domain)) {
                        skippedCertificates.push({
                            GUID: cert.GUID,
                            alias: cert.alias,
                            domain: cert.domain,
                            reason: 'no_valid_certificate_for_same_domain'
                        });
                    }
                }

                for (const cert of candidates) {
                    if (test) {
                        deletedCertificates.push({
                            GUID: cert.GUID,
                            alias: cert.alias,
                            domain: cert.domain,
                            status: cert.status,
                            expired: cert.expired,
                            simulated: true
                        });
                        continue;
                    }

                    try {
                        const deletionResult = await deleteCertificateByGuid(cert.GUID);
                        deletedCertificates.push({
                            GUID: cert.GUID,
                            alias: cert.alias,
                            domain: cert.domain,
                            status: cert.status,
                            expired: cert.expired,
                            deletedType: deletionResult.deletedType,
                            simulated: false
                        });
                    } catch (error) {
                        skippedCertificates.push({
                            GUID: cert.GUID,
                            alias: cert.alias,
                            domain: cert.domain,
                            reason: 'delete_failed',
                            error: error.response?.data?.error || error.message
                        });
                    }
                }

                return {
                    mode: test ? 'test' : 'productive',
                    totalCertificates: certificates.length,
                    totalCandidates: candidates.length,
                    totalDeleted: deletedCertificates.length,
                    totalSkipped: skippedCertificates.length,
                    deletedCertificates,
                    skippedCertificates
                };
            }

            if (!test && schedulerJobId) {
                cds.spawn(async () => {
                    LOG.debug('CDS Spawn deleteExpiredCertificates');

                    const response = await axios.get(`${btpSchedulerCredentials.uaa.url}/oauth/token?grant_type=client_credentials&response_type=token`, {
                        headers: {
                            'Authorization': `Basic ${authString}`
                        }
                    });

                    const token = response.data.access_token;
                    const axiosConfig = {
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: 'Bearer ' + token
                        }
                    };

                    const schedulerUrl = `${schedulerHost}/scheduler/jobs/${schedulerJobId}/schedules/${schedulerScheduleId}/runs/${schedulerRunId}`;

                    try {
                        const result = await processDeleteExpiredCertificates();
                        LOG.debug('deleteExpiredCertificates result', result);
                        await axios.put(schedulerUrl, JSON.stringify({ success: true, message: JSON.stringify(result) }), axiosConfig);
                    } catch (error) {
                        console.error('Error deleting expired certificates', error);
                        await axios.put(
                            schedulerUrl,
                            JSON.stringify({ success: false, message: `Error deleting expired certificates: ${error.message}` }),
                            axiosConfig
                        );
                    }
                });

                let { res } = req.http;
                res.status(202).send('Accepted async job, but long-running operation still running.');
                return;
            }

            const result = await processDeleteExpiredCertificates();
            return JSON.stringify(result);
        });


        return super.init();
    }
};

module.exports = { CatalogService };