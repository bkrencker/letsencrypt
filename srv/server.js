const cds = require('@sap/cds')
const express = require('express')

const challengeFolderPath = __dirname + '/static/.well-known/acme-challenge/';

cds.on('bootstrap', (app) => {
    // add your own middleware before any by cds are added

    /**
     * Serve static folder for Let's Encrypt acme-challenge.
     * This path is public and therefore not protected from XSUAA !
     */
    app.use(express.static(__dirname + '/static', { dotfiles: 'allow' }))

    console.log("Activated static folder: " + challengeFolderPath);
})
